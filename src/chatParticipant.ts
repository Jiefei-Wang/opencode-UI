import * as vscode from "vscode"
import { showThinking } from "./settings"
import { OpenCodeServices } from "./services"

export function registerChatParticipant(ctx: vscode.ExtensionContext, services: OpenCodeServices) {
  const handler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
    try {
      await handleSlashCommand(request, stream, services)
      if (request.command) return {}

      const prompt = request.prompt.trim()
      if (!prompt) {
        stream.markdown("Ask OpenCode what to change, explain, inspect, or build. Use `/new`, `/resume`, `/agent`, `/skill`, `/todo`, or `/diff` for shortcuts.")
        return {}
      }

      stream.progress("Starting OpenCode...")
      const rt = await services.ensureReady()
      const session = await services.activeOrNewSession(rt)
      const eventCts = new vscode.CancellationTokenSource()
      const cancelSub = token.onCancellationRequested(() => eventCts.cancel())
      const events = streamSessionEvents(services, rt.workspaceId, session.id, stream, eventCts.token)
      try {
        await services.sendPromptToSession(rt, session, prompt)
        stream.progress(`Using session ${session.id}`)

        await events
      } finally {
        cancelSub.dispose()
        eventCts.cancel()
        eventCts.dispose()
      }
      return { metadata: { sessionID: session.id } }
    } catch (err) {
      stream.markdown(`OpenCode error: ${escapeMd(text(err))}`)
      stream.button({ command: "opencode.openOutput", title: "Open Output" })
      stream.button({ command: "opencode.restartServer", title: "Restart Server" })
      return {}
    }
  }

  const participant = vscode.chat.createChatParticipant("opencode.opencode", handler)
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "opencode.svg")
  participant.followupProvider = {
    provideFollowups() {
      return [
        { prompt: "/todo", label: "Show todos" },
        { prompt: "/diff", label: "Show modified files" },
        { prompt: "/agent", label: "Pick an agent" },
      ]
    },
  }
  ctx.subscriptions.push(participant)
}

async function handleSlashCommand(request: vscode.ChatRequest, stream: vscode.ChatResponseStream, services: OpenCodeServices) {
  switch (request.command) {
    case "new": {
      const rt = await services.ensureReady()
      const session = await services.newSession(rt)
      stream.markdown(`Started OpenCode session \`${session.id}\`.`)
      return
    }
    case "resume": {
      const session = await services.resumeSession()
      stream.markdown(session ? `Resumed OpenCode session \`${session.id}\`.` : "No session selected.")
      return
    }
    case "sessions": {
      const rt = await services.ensureReady()
      const sessions = await services.refreshSessions(rt)
      stream.markdown(sessions.length ? sessions.map((s) => `- ${escapeMd(s.title || s.id)} \`${s.id}\``).join("\n") : "No OpenCode sessions found.")
      return
    }
    case "agent": {
      const agents = await services.listAgents()
      stream.markdown(agents.length ? agents.filter((a) => !a.hidden).map((a) => `- \`@${a.name}\` ${a.mode ? `(${a.mode})` : ""}`).join("\n") : "No agents returned by OpenCode.")
      stream.button({ command: "opencode.pickAgent", title: "Pick Agent" })
      return
    }
    case "skill": {
      const skills = await services.listSkills()
      stream.markdown(skills.length ? skills.map((s) => `- \`${s.triggerText.trim()}\` ${s.description ?? ""}`).join("\n") : "No skills returned by OpenCode yet.")
      stream.button({ command: "opencode.pickSkill", title: "Pick Skill" })
      return
    }
    case "model": {
      const models = await services.listModels()
      stream.markdown(models.length ? models.map((m) => `- ${escapeMd(m.label)} \`${m.providerID}/${m.modelID}\``).join("\n") : "No models returned by OpenCode.")
      stream.button({ command: "opencode.pickModel", title: "Pick Model" })
      return
    }
    case "todo": {
      const rt = await services.ensureReady()
      const todos = await services.refreshTodos(rt)
      stream.markdown(todos.length ? todos.map((t) => `- [${t.status === "completed" ? "x" : " "}] ${escapeMd(t.content)} (${t.priority})`).join("\n") : "No todos for the active session.")
      return
    }
    case "diff": {
      const rt = await services.ensureReady()
      const diffs = await services.refreshDiff(rt)
      stream.markdown(diffs.length ? diffs.map((d) => `- ${escapeMd(d.file)} +${d.additions ?? 0} -${d.deletions ?? 0}`).join("\n") : "No modified files for the active session.")
      stream.button({ command: "opencode.showDiff", title: "Open Diff Panel" })
      return
    }
    case "abort": {
      const ok = await services.abortActive()
      stream.markdown(ok ? "Aborted the active OpenCode run." : "No active OpenCode run found.")
      return
    }
    case "permissions": {
      const snap = services.snapshot().flatMap((s) => s.permissions.map((p) => ({ workspaceId: s.workspaceId, p })))
      if (!snap.length) stream.markdown("No pending OpenCode permissions.")
      for (const item of snap) {
        stream.markdown(`Permission requested: **${escapeMd(item.p.permission)}**\n`)
        stream.button({ command: "opencode.permission.once", title: "Approve Once", arguments: [item.workspaceId, item.p.id] })
        stream.button({ command: "opencode.permission.always", title: "Approve Always", arguments: [item.workspaceId, item.p.id] })
        stream.button({ command: "opencode.permission.reject", title: "Reject", arguments: [item.workspaceId, item.p.id] })
      }
      return
    }
    case "status": {
      const status = services.snapshot().map((s) => `- ${s.name}: ${s.state}${s.error ? ` (${escapeMd(s.error)})` : ""}`).join("\n")
      stream.markdown(status || "No OpenCode workspace runtime yet.")
      return
    }
  }
}

async function streamSessionEvents(services: OpenCodeServices, workspaceId: string, sessionID: string, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) {
  let sawText = false
  const messageRoles = new Map<string, "user" | "assistant">()
  const partTypes = new Map<string, "reasoning" | "text">()
  const completedReasoningParts = new Set<string>()
  await new Promise<void>((resolve) => {
    let finished = false
    let sub: vscode.Disposable | undefined
    let cancelSub: vscode.Disposable | undefined
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      sub?.dispose()
      cancelSub?.dispose()
      resolve()
    }
    const timeout = setTimeout(finish, 5 * 60 * 1000)
    sub = services.onDidEvent(({ workspaceId: eventWorkspace, event }) => {
      if (eventWorkspace !== workspaceId) return
      const props = event.properties ?? {}
      const eventSession = props.sessionID ?? props.info?.sessionID ?? props.part?.sessionID
      if (eventSession && eventSession !== sessionID) return

      if (event.type === "message.updated" && props.info?.id && props.info?.role) {
        messageRoles.set(props.info.id, props.info.role)
      }

      if (event.type === "message.part.delta" && typeof props.delta === "string") {
        if (!isAssistantMessageEvent(messageRoles, props)) return
        const partType = props.part?.type ?? partTypes.get(props.partID)
        if (partType === "text") {
          sawText = true
          stream.markdown(props.delta)
        }
      }

      if (event.type === "message.part.updated") {
        if (!isAssistantMessageEvent(messageRoles, props)) return
        const part = props.part
        if (part?.id && (part.type === "reasoning" || part.type === "text")) {
          partTypes.set(part.id, part.type)
        }
        if (part?.type === "reasoning" && showThinking() && part.id && part.text && part.time?.end && !completedReasoningParts.has(part.id)) {
          completedReasoningParts.add(part.id)
          stream.markdown(`\n<details><summary>Thinking</summary>\n\n${part.text}\n\n</details>\n`)
        }
        if (part?.type === "text" && part.text && !sawText) stream.markdown(part.text)
        if (part?.type === "tool") stream.progress(toolProgress(part))
      }

      if (event.type === "session.error") {
        stream.markdown(`\nOpenCode error: ${escapeMd(text(props.error ?? props))}`)
        finish()
      }

      if (event.type === "permission.asked") {
        stream.markdown(`\nOpenCode needs permission: **${escapeMd(props.permission ?? "tool")}**\n`)
        stream.button({ command: "opencode.permission.once", title: "Approve Once", arguments: [workspaceId, props.id] })
        stream.button({ command: "opencode.permission.always", title: "Approve Always", arguments: [workspaceId, props.id] })
        stream.button({ command: "opencode.permission.reject", title: "Reject", arguments: [workspaceId, props.id] })
      }

      if (event.type === "session.status" && props.status?.type !== "busy") finish()
      if (event.type === "session.idle") finish()
    })
    cancelSub = token.onCancellationRequested(finish)
  })
}

function toolProgress(part: any) {
  const title = part.state?.title || part.tool || "tool"
  const status = part.state?.status || "running"
  return `${title}: ${status}`
}

function isAssistantMessageEvent(messageRoles: Map<string, "user" | "assistant">, props: any) {
  const messageID = props.messageID ?? props.part?.messageID
  return Boolean(messageID && messageRoles.get(messageID) === "assistant")
}

function escapeMd(value: string) {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, "\\$&")
}

function text(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
