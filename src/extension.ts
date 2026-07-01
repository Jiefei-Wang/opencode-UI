import * as vscode from "vscode"
import { registerChatParticipant } from "./chatParticipant"
import { registerCommands } from "./commands"
import { OpenCodePanelProvider } from "./panelProvider"
import { autoStart, richPanelEnabled } from "./settings"
import { OpenCodeServices } from "./services"
import { OpenCodeStatusBar } from "./statusBar"
import { WorkspaceManager } from "./workspaceManager"

let mgr: WorkspaceManager | undefined
let services: OpenCodeServices | undefined

export async function activate(ctx: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("OpenCode")
  out.appendLine(`OpenCode activating (remote=${vscode.env.remoteName || "local"})`)

  mgr = new WorkspaceManager(out)
  services = new OpenCodeServices(mgr, ctx, out)

  registerCommands(ctx, mgr, services, out)
  registerChatParticipant(ctx, services)

  const status = new OpenCodeStatusBar(services)
  status.register(ctx)
  ctx.subscriptions.push(status)

  if (richPanelEnabled()) {
    const panel = new OpenCodePanelProvider(ctx, services)
    ctx.subscriptions.push(
      panel,
      vscode.window.registerWebviewViewProvider("opencode.secondaryPanel", panel),
    )
  }

  ctx.subscriptions.push(out, mgr, services)
  ctx.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void mgr?.sync(vscode.workspace.workspaceFolders ?? [])))

  await mgr.sync(vscode.workspace.workspaceFolders ?? [])
  if (autoStart() === "onWorkspaceOpen" && vscode.workspace.workspaceFolders?.length) {
    for (const folder of vscode.workspace.workspaceFolders) {
      void services.ensureReady(folder).catch((err) => out.appendLine(`auto start failed (${folder.name}): ${err instanceof Error ? err.message : String(err)}`))
    }
  }
}

export async function deactivate() {
  services?.dispose()
  await mgr?.shutdown()
  mgr?.dispose()
  services = undefined
  mgr = undefined
}
