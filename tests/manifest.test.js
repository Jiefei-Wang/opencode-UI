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

test("OpenCode panel title uses grouped menu instead of inline Open Chat", () => {
  const titleItems = pkg.contributes.menus["view/title"].filter((item) => item.when === "view == opencode.secondaryPanel")
  assert.equal(titleItems.some((item) => item.command === "opencode.openChat"), false)
  assert.ok(titleItems.some((item) => item.command === "opencode.newSession"))
  assert.ok(titleItems.some((item) => item.command === "opencode.restartServer"))
  assert.ok(titleItems.some((item) => item.submenu === "opencode.panelMenu"))

  const commandIds = pkg.contributes.commands.map((item) => item.command)
  const categorySubmenuIds = pkg.contributes.menus["opencode.panelMenu"].map((item) => item.submenu)
  assert.ok(categorySubmenuIds.length > 0)
  assert.ok(pkg.contributes.menus["opencode.panelMenu"].every((item) => item.submenu && !item.command))

  const menuCommandIds = categorySubmenuIds.flatMap((id) => (pkg.contributes.menus[id] || []).map((item) => item.command).filter(Boolean))
  assert.deepEqual([...menuCommandIds].sort(), [...commandIds].sort())
})
