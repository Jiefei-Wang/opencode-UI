import * as vscode from "vscode"
import { OpenCodeServices } from "./services"

export class OpenCodeStatusBar implements vscode.Disposable {
  private item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90)

  constructor(private services: OpenCodeServices) {
    this.item.command = "opencode.statusMenu"
    this.item.show()
    this.services.onDidChange(() => this.update())
    this.update()
  }

  register(ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(this.item)
    ctx.subscriptions.push(vscode.commands.registerCommand("opencode.statusMenu", async () => {
      const picked = await vscode.window.showQuickPick([
        { label: "Open Chat", command: "opencode.openChat" },
        { label: "Open Panel", command: "opencode.openPanel" },
        { label: "New Session", command: "opencode.newSession" },
        { label: "Pick Agent", command: "opencode.pickAgent" },
        { label: "Pick Skill", command: "opencode.pickSkill" },
        { label: "Abort", command: "opencode.abort" },
        { label: "Restart Server", command: "opencode.restartServer" },
        { label: "Check Environment", command: "opencode.checkEnvironment" },
        { label: "Open Output", command: "opencode.openOutput" },
      ], { placeHolder: "OpenCode" })
      if (picked) await vscode.commands.executeCommand(picked.command)
    }))
  }

  dispose() {
    this.item.dispose()
  }

  private update() {
    const snapshots = this.services.snapshot()
    const state = snapshots[0]?.state ?? "stopped"
    const pendingPermissions = snapshots.some((s) => s.permissions.length > 0)
    this.item.text = pendingPermissions ? "$(warning) OpenCode" : `$(hubot) OpenCode: ${state}`
    this.item.tooltip = snapshots[0]?.error || "OpenCode"
  }
}
