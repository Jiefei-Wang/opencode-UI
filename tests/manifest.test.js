const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
const extension = fs.readFileSync("src/extension.ts", "utf8")
const commands = fs.readFileSync("src/commands.ts", "utf8")

test("OpenCode contributes its primary UI to the right secondary sidebar like Codex", () => {
  assert.deepEqual(pkg.contributes.viewsContainers.activitybar, undefined)
  assert.equal(pkg.contributes.viewsContainers.secondarySidebar[0].id, "opencodeSecondaryViewContainer")
  assert.equal(pkg.contributes.views.opencodeSecondaryViewContainer[0].id, "opencode.secondaryPanel")
  assert.equal(pkg.contributes.views.opencodeSecondaryViewContainer[0].type, "webview")
})

test("OpenCode no longer contributes its visible panel to the built-in Chat container or Explorer", () => {
  assert.equal(pkg.contributes.views["workbench.panel.chat"], undefined)
  assert.equal(pkg.contributes.views.explorer, undefined)
})

test("manifest activation and provider registration include the secondary sidebar view id", () => {
  assert.ok(pkg.activationEvents.includes("onView:opencode.secondaryPanel"))
  assert.match(extension, /registerWebviewViewProvider\("opencode\.secondaryPanel"/)
  assert.doesNotMatch(extension, /registerWebviewViewProvider\("opencode\.panel"/)
})

test("Open Panel command focuses the secondary sidebar only", () => {
  assert.match(commands, /opencode\.secondaryPanel\.focus/)
  assert.doesNotMatch(commands, /opencode\.panel\.focus/)
})
