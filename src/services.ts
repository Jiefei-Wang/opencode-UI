import * as vscode from "vscode"
import { defaultAgent, defaultModel } from "./settings"
import type { AgentInfo, CommandInfo, FileDiff, ModelPick, OpenCodeClient, PermissionReply, PermissionRequest, QuestionRequest, SessionEvent, SessionInfo, SkillInfo, Todo } from "./opencodeTypes"
import { WorkspaceManager, WorkspaceRuntime } from "./workspaceManager"

export class OpenCodeServices implements vscode.Disposable {
  private activeSessions = new Map<string, string>()
  private sessions = new Map<string, SessionInfo[]>()
  private todos = new Map<string, Todo[]>()
  private diffs = new Map<string, FileDiff[]>()
  private permissions = new Map<string, PermissionRequest[]>()
  private questions = new Map<string, QuestionRequest[]>()
  private agents = new Map<string, AgentInfo[]>()
  private skills = new Map<string, SkillInfo[]>()
  private models = new Map<string, ModelPick[]>()
  private eventAbort = new Map<string, { ctrl: AbortController; client: OpenCodeClient }>()
  private emitter = new vscode.EventEmitter<void>()
  private eventEmitter = new vscode.EventEmitter<{ workspaceId: string; event: SessionEvent }>()
  private readonly mgrSub: vscode.Disposable

  readonly onDidChange = this.emitter.event
  readonly onDidEvent = this.eventEmitter.event

  constructor(private mgr: WorkspaceManager, private context: vscode.ExtensionContext, private out: vscode.OutputChannel) {
    this.mgrSub = this.mgr.onDidChange(() => {
      void this.syncEventSubscriptions()
      this.fire()
    })
  }

  async ensureReady(folder?: vscode.WorkspaceFolder) {
    this.log(`ensureReady requested folder=${folder?.uri.fsPath ?? "<default>"}`)
    const rt = await this.mgr.ensure(folder)
    if ((rt.state !== "ready" && rt.state !== "busy") || !rt.client) {
      this.log(`ensureReady failed workspace=${rt.name} state=${rt.state} error=${rt.error ?? "<none>"}`)
      throw new Error(rt.error || "OpenCode server is not ready")
    }
    await this.syncRuntime(rt)
    this.log(`ensureReady ok workspace=${rt.name} url=${rt.url ?? "<none>"}`)
    return rt
  }

  snapshot() {
    return this.mgr.list().map((rt) => ({
      workspaceId: rt.workspaceId,
      name: rt.name,
      dir: rt.dir,
      state: rt.state,
      error: rt.error,
      url: rt.url,
      activeSessionId: this.activeSessions.get(rt.workspaceId),
      sessions: this.sessions.get(rt.workspaceId) ?? [],
      todos: this.todos.get(rt.workspaceId) ?? [],
      diffs: this.diffs.get(rt.workspaceId) ?? [],
      permissions: this.permissions.get(rt.workspaceId) ?? [],
      questions: this.questions.get(rt.workspaceId) ?? [],
      agents: this.agents.get(rt.workspaceId) ?? [],
      skills: this.skills.get(rt.workspaceId) ?? [],
      models: this.models.get(rt.workspaceId) ?? [],
    }))
  }

  async newSession(rt?: WorkspaceRuntime, title?: string) {
    const runtime = rt ?? await this.ensureReady()
    this.log(`[${runtime.name}] creating session dir=${runtime.dir} title=${title ?? "<none>"}`)
    const res = await runtime.client!.session.create({ directory: runtime.dir, title })
    const session = res.data
    this.log(`[${runtime.name}] create session response id=${session?.id ?? "<missing>"} raw=${safeJson(res)}`)
    if (!session?.id) throw new Error(`OpenCode did not return a session. Response: ${safeJson(res)}`)
    this.setActiveSession(runtime.workspaceId, session.id)
    await this.refreshSessions(runtime).catch((err) => this.log(`[${runtime.name}] refresh sessions after create failed: ${text(err)}`))
    this.fire()
    return session
  }

  async resumeSession(rt?: WorkspaceRuntime) {
    const runtime = rt ?? await this.ensureReady()
    const sessions = await this.refreshSessions(runtime)
    if (!sessions.length) return await this.newSession(runtime)
    const picked = await vscode.window.showQuickPick(sessions.map((s) => ({ label: sessionTitle(s), description: s.id, session: s })), { placeHolder: "Resume OpenCode session" })
    if (!picked) return undefined
    this.setActiveSession(runtime.workspaceId, picked.session.id)
    this.fire()
    return picked.session
  }

  async selectSession(workspaceId: string, sessionID: string) {
    const rt = this.mgr.get(workspaceId)
    if (!rt?.client) throw new Error("OpenCode workspace is not ready")
    this.setActiveSession(workspaceId, sessionID)
    await Promise.all([this.refreshTodos(rt).catch(() => []), this.refreshDiff(rt).catch(() => [])])
    this.fire()
  }

  async activeOrNewSession(rt: WorkspaceRuntime) {
    const activeId = this.activeSessions.get(rt.workspaceId) ?? this.context.workspaceState.get<string>(stateKey(rt.workspaceId))
    if (activeId) {
      this.activeSessions.set(rt.workspaceId, activeId)
      return { id: activeId } as SessionInfo
    }
    return await this.newSession(rt)
  }

  async sendPrompt(prompt: string, opts?: { agent?: string; model?: ModelPick }) {
    this.log(`sendPrompt requested chars=${prompt.length}`)
    const rt = await this.ensureReady()
    const session = await this.activeOrNewSession(rt)
    await this.sendPromptToSession(rt, session, prompt, opts)
    return { rt, session }
  }

  async sendPromptToSession(rt: WorkspaceRuntime, session: SessionInfo, prompt: string, opts?: { agent?: string; model?: ModelPick }) {
    const agent = opts?.agent ?? (defaultAgent() || undefined)
    const model = opts?.model ?? parseModel(defaultModel())
    this.log(`[${rt.name}] sending prompt session=${session.id} agent=${agent ?? "<default>"} model=${model ? `${model.providerID}/${model.modelID}` : "<default>"}`)
    await rt.client!.session.promptAsync({
      sessionID: session.id,
      directory: rt.dir,
      agent,
      model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      parts: [{ type: "text", text: prompt }],
    })
    this.log(`[${rt.name}] prompt accepted session=${session.id}`)
  }

  async abortActive(rt?: WorkspaceRuntime) {
    const runtime = rt ?? this.mgr.get()
    const sessionID = runtime ? this.activeSessions.get(runtime.workspaceId) : undefined
    if (!runtime?.client || !sessionID) return false
    await runtime.client.session.abort({ sessionID, directory: runtime.dir })
    return true
  }

  async refreshSessions(rt: WorkspaceRuntime) {
    if (!rt.client) return []
    const [listRes, statusRes] = await Promise.all([
      rt.client.session.list({ directory: rt.dir, roots: true }),
      rt.client.session.status({ directory: rt.dir }).catch(() => ({ data: undefined })),
    ])
    const list = listRes.data ?? []
    this.sessions.set(rt.workspaceId, list)
    const statuses = statusRes.data ?? {}
    let busy = false
    for (const session of list) {
      if (statuses[session.id]?.type === "busy") {
        busy = true
      }
    }
    rt.state = busy ? "busy" : "ready"
    this.fire()
    return list
  }

  async refreshTodos(rt: WorkspaceRuntime) {
    const sessionID = this.activeSessions.get(rt.workspaceId)
    if (!rt.client || !sessionID) return []
    const res = await rt.client.session.todo({ sessionID, directory: rt.dir })
    const list = res.data ?? []
    this.todos.set(rt.workspaceId, list)
    this.fire()
    return list
  }

  async refreshDiff(rt: WorkspaceRuntime) {
    const sessionID = this.activeSessions.get(rt.workspaceId)
    if (!rt.client || !sessionID) return []
    const res = await rt.client.session.diff({ sessionID, directory: rt.dir })
    const list = res.data ?? []
    this.diffs.set(rt.workspaceId, list)
    this.fire()
    return list
  }

  async listAgents(rt?: WorkspaceRuntime) {
    const runtime = rt ?? await this.ensureReady()
    const res = await runtime.client?.app?.agents({ directory: runtime.dir }).catch(() => ({ data: [] }))
    const list = res?.data ?? []
    this.agents.set(runtime.workspaceId, list)
    this.fire()
    return list
  }

  async pickAgent(insertOnly = true) {
    const rt = await this.ensureReady()
    const agents = await this.listAgents(rt)
    const picked = await vscode.window.showQuickPick(agents.filter((a) => !a.hidden).map((a) => ({ label: a.name, description: a.mode, detail: a.model ? `${a.model.providerID}/${a.model.modelID}` : undefined, agent: a })), { placeHolder: "Pick OpenCode agent" })
    if (!picked) return undefined
    const text = `@${picked.agent.name} `
    if (insertOnly) await vscode.env.clipboard.writeText(text)
    else await this.sendPrompt(text)
    return picked.agent
  }

  async listSkills(rt?: WorkspaceRuntime) {
    const runtime = rt ?? await this.ensureReady()
    const res = await runtime.client?.command?.list({ directory: runtime.dir }).catch(() => ({ data: [] }))
    const commands = res?.data ?? []
    const skills = normalizeSkills(commands)
    this.skills.set(runtime.workspaceId, skills)
    this.fire()
    return skills
  }

  async pickSkill(insertOnly = true) {
    const rt = await this.ensureReady()
    const skills = await this.listSkills(rt)
    const picked = await vscode.window.showQuickPick(skills.map((s) => ({ label: s.name, description: s.source, detail: s.description, skill: s })), { placeHolder: "Pick OpenCode skill" })
    if (!picked) return undefined
    if (insertOnly) await vscode.env.clipboard.writeText(picked.skill.triggerText)
    else await this.sendPrompt(picked.skill.triggerText)
    return picked.skill
  }

  async listModels(rt?: WorkspaceRuntime) {
    const runtime = rt ?? await this.ensureReady()
    const providerRes = await runtime.client?.provider?.list({ directory: runtime.dir }).catch(() => ({ data: undefined }))
    const configRes = await runtime.client?.config?.providers({ directory: runtime.dir }).catch(() => ({ data: undefined }))
    const providerData = providerRes?.data
    const providers = Array.isArray(providerData) ? providerData : providerData?.all ?? providerData?.providers ?? configRes?.data?.providers ?? []
    const models = providers.flatMap((provider) => Object.entries(provider.models ?? {}).map(([key, value]) => {
      const model = value as { id?: string; name?: string }
      return {
      providerID: provider.id,
      modelID: model.id ?? key,
      label: `${provider.name ?? provider.id}: ${model.name ?? model.id ?? key}`,
    }}))
    this.models.set(runtime.workspaceId, models)
    this.fire()
    return models
  }

  async pickModel() {
    const rt = await this.ensureReady()
    const models = await this.listModels(rt)
    const picked = await vscode.window.showQuickPick(models.map((m) => ({ label: m.label, description: `${m.providerID}/${m.modelID}`, model: m })), { placeHolder: "Pick OpenCode model" })
    return picked?.model
  }

  async replyPermission(workspaceId: string, requestID: string, reply: PermissionReply) {
    const rt = this.mgr.get(workspaceId)
    if (!rt?.client?.permission) return
    await rt.client.permission.reply({ requestID, directory: rt.dir, reply })
    await this.refreshPermissions(rt)
  }

  async refreshPermissions(rt: WorkspaceRuntime) {
    const res = await rt.client?.permission?.list({ directory: rt.dir }).catch(() => ({ data: [] }))
    const list = res?.data ?? []
    this.permissions.set(rt.workspaceId, list)
    this.fire()
    return list
  }

  async refreshQuestions(rt: WorkspaceRuntime) {
    const res = await rt.client?.question?.list({ directory: rt.dir }).catch(() => ({ data: [] }))
    const list = res?.data ?? []
    this.questions.set(rt.workspaceId, list)
    this.fire()
    return list
  }

  async checkEnvironment() {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) return "No workspace folder is open."
    try {
      const rt = await this.ensureReady(folder)
      return `OpenCode server is ${rt.state} at ${rt.url ?? "unknown URL"} on ${vscode.env.remoteName || "local"}.`
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  dispose() {
    for (const entry of this.eventAbort.values()) entry.ctrl.abort()
    this.mgrSub.dispose()
    this.emitter.dispose()
    this.eventEmitter.dispose()
  }

  private setActiveSession(workspaceId: string, sessionID: string) {
    this.activeSessions.set(workspaceId, sessionID)
    void this.context.workspaceState.update(stateKey(workspaceId), sessionID)
  }

  private async syncRuntime(rt: WorkspaceRuntime) {
    await Promise.all([
      this.refreshSessions(rt).catch(() => []),
      this.listAgents(rt).catch(() => []),
      this.listSkills(rt).catch(() => []),
      this.listModels(rt).catch(() => []),
      this.refreshPermissions(rt).catch(() => []),
      this.refreshQuestions(rt).catch(() => []),
    ])
    const active = this.activeSessions.get(rt.workspaceId) ?? this.context.workspaceState.get<string>(stateKey(rt.workspaceId))
    if (active) {
      this.activeSessions.set(rt.workspaceId, active)
      await Promise.all([this.refreshTodos(rt).catch(() => []), this.refreshDiff(rt).catch(() => [])])
    }
  }

  private async syncEventSubscriptions() {
    const currentIds = new Set(this.mgr.list().map((rt) => rt.workspaceId))
    for (const [workspaceId, existing] of this.eventAbort) {
      if (currentIds.has(workspaceId)) continue
      existing.ctrl.abort()
      this.eventAbort.delete(workspaceId)
    }

    for (const rt of this.mgr.list()) {
      const existing = this.eventAbort.get(rt.workspaceId)
      if ((rt.state !== "ready" && rt.state !== "busy") || !rt.client?.event) {
        existing?.ctrl.abort()
        this.eventAbort.delete(rt.workspaceId)
        continue
      }
      if (existing?.client === rt.client) continue
      existing?.ctrl.abort()
      this.eventAbort.delete(rt.workspaceId)
      const ctrl = new AbortController()
      this.eventAbort.set(rt.workspaceId, { ctrl, client: rt.client })
      void this.consumeEvents(rt, ctrl)
    }
  }

  private async consumeEvents(rt: WorkspaceRuntime, ctrl: AbortController) {
    try {
      const sub = await rt.client!.event!.subscribe({ directory: rt.dir }, { signal: ctrl.signal, onSseError: (err) => this.out.appendLine(`[${rt.name}] event stream error: ${text(err)}`) })
      for await (const event of sub.stream) {
        if (ctrl.signal.aborted) break
        this.handleEvent(rt, event)
      }
    } catch (err) {
      if (!ctrl.signal.aborted) this.out.appendLine(`[${rt.name}] event stream stopped: ${text(err)}`)
    } finally {
      if (this.eventAbort.get(rt.workspaceId)?.ctrl === ctrl) {
        this.eventAbort.delete(rt.workspaceId)
      }
    }
  }

  private handleEvent(rt: WorkspaceRuntime, event: SessionEvent) {
    if (event.type === "todo.updated") this.todos.set(rt.workspaceId, event.properties?.todos ?? [])
    if (event.type === "session.diff") this.diffs.set(rt.workspaceId, event.properties?.diff ?? [])
    if (event.type === "permission.asked" || event.type === "permission.updated") this.permissions.set(rt.workspaceId, [...(this.permissions.get(rt.workspaceId) ?? []), normalizePermission(event.properties)])
    if (event.type === "permission.replied") this.permissions.set(rt.workspaceId, (this.permissions.get(rt.workspaceId) ?? []).filter((permission) => permission.id !== event.properties?.id))
    if (event.type === "question.asked") this.questions.set(rt.workspaceId, [...(this.questions.get(rt.workspaceId) ?? []), event.properties])
    if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") void this.refreshSessions(rt)
    if (event.type === "session.status") rt.state = event.properties?.status?.type === "busy" ? "busy" : "ready"
    if (event.type === "session.idle") rt.state = "ready"
    if (event.type === "session.error") rt.error = text(event.properties?.error ?? event.properties ?? "OpenCode session failed")
    this.eventEmitter.fire({ workspaceId: rt.workspaceId, event })
    this.fire()
  }

  private fire() {
    this.emitter.fire()
  }

  private log(message: string) {
    this.out.appendLine(`[services] ${message}`)
  }
}

function normalizeSkills(commands: CommandInfo[]): SkillInfo[] {
  return commands
    .map((cmd) => ({
      id: cmd.name,
      name: cmd.name,
      description: cmd.description,
      source: cmd.source === "mcp" ? "mcp" : "unknown",
      triggerText: `/${cmd.name} `,
      hints: cmd.hints ?? [],
    }))
}

function normalizePermission(value: any): PermissionRequest {
  return {
    id: String(value?.id ?? value?.requestID ?? ""),
    sessionID: String(value?.sessionID ?? ""),
    permission: String(value?.permission ?? value?.title ?? value?.type ?? "Permission requested"),
    patterns: value?.patterns,
    metadata: value?.metadata,
  }
}

function parseModel(value: string): ModelPick | undefined {
  const [providerID, modelID] = value.split("/")
  if (!providerID || !modelID) return undefined
  return { providerID, modelID, label: value }
}

function stateKey(workspaceId: string) {
  return `opencode.activeSession.${workspaceId}`
}

function sessionTitle(session: SessionInfo) {
  return session.title || session.id
}

function text(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
