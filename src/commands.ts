import * as vscode from "vscode"
import { OpenCodeServices } from "./services"
import { WorkspaceManager } from "./workspaceManager"

export function registerCommands(ctx: vscode.ExtensionContext, mgr: WorkspaceManager, services: OpenCodeServices, out: vscode.OutputChannel) {
  const reg = (id: string, run: (...args: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, run))

  reg("opencode.openChat", async () => {
    await vscode.commands.executeCommand("workbench.panel.chat.view.copilot.focus").then(undefined, async () => {
      await vscode.commands.executeCommand("workbench.action.chat.open").then(undefined, () => undefined)
    })
  })

  reg("opencode.openPanel", async () => {
    await vscode.commands.executeCommand("opencode.secondaryPanel.focus")
  })

  for (const id of ["opencode.status.ready", "opencode.status.busy", "opencode.status.starting", "opencode.status.stopped", "opencode.status.error"]) {
    reg(id, () => undefined)
  }

  reg("opencode.newSession", async () => {
    const rt = await services.ensureReady()
    const session = await services.newSession(rt)
    vscode.window.showInformationMessage(`OpenCode session started: ${session.id}`)
  })

  reg("opencode.resumeSession", async () => {
    const session = await services.resumeSession()
    if (session) vscode.window.showInformationMessage(`OpenCode session resumed: ${session.id}`)
  })

  reg("opencode.pickAgent", async () => {
    const agent = await services.pickAgent(true)
    if (agent) vscode.window.showInformationMessage(`Copied agent mention @${agent.name} to clipboard.`)
  })

  reg("opencode.pickSkill", async () => {
    const skill = await services.pickSkill(true)
    if (skill) vscode.window.showInformationMessage(`Copied skill trigger ${skill.triggerText.trim()} to clipboard.`)
  })

  reg("opencode.pickModel", async () => {
    const model = await services.pickModel()
    vscode.window.showInformationMessage(model ? `Selected model: ${model.providerID}/${model.modelID}` : "Using OpenCode default model.")
  })

  reg("opencode.showTodo", async () => {
    await vscode.commands.executeCommand("opencode.openPanel")
  })

  reg("opencode.showDiff", async () => {
    await vscode.commands.executeCommand("opencode.openPanel")
  })

  reg("opencode.abort", async () => {
    const ok = await services.abortActive()
    vscode.window.showInformationMessage(ok ? "OpenCode run aborted." : "No active OpenCode run found.")
  })

  reg("opencode.restartServer", async () => {
    const rt = await mgr.restart()
    vscode.window.showInformationMessage(rt?.state === "ready" ? "OpenCode server restarted." : `OpenCode restart failed: ${rt?.error ?? "unknown error"}`)
  })

  reg("opencode.checkEnvironment", async () => {
    const message = await services.checkEnvironment()
    vscode.window.showInformationMessage(message)
  })

  reg("opencode.openOutput", () => out.show())

  reg("opencode.permission.once", (workspaceId: string, requestID: string) => services.replyPermission(workspaceId, requestID, "once"))
  reg("opencode.permission.always", (workspaceId: string, requestID: string) => services.replyPermission(workspaceId, requestID, "always"))
  reg("opencode.permission.reject", (workspaceId: string, requestID: string) => services.replyPermission(workspaceId, requestID, "reject"))
}
