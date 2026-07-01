import * as assert from "node:assert/strict"
import * as vscode from "vscode"

suite("OpenCode extension host", () => {
  test("activates and registers core commands", async () => {
    const ext = vscode.extensions.getExtension("local.opencode-vscode")
    assert.ok(ext, "extension should be discoverable by publisher/name")

    await ext.activate()

    const commands = await vscode.commands.getCommands(true)
    for (const command of [
      "opencode.openPanel",
      "opencode.newSession",
      "opencode.abort",
      "opencode.checkEnvironment",
    ]) {
      assert.ok(commands.includes(command), `${command} should be registered`)
    }
  })

  test("uses workspace-open autostart as the contributed default", () => {
    assert.equal(vscode.workspace.getConfiguration("opencode").get("autoStart"), "onWorkspaceOpen")
  })

  test("focuses the contributed side panel command", async () => {
    await vscode.commands.executeCommand("opencode.openPanel")
  })
})
