const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const source = fs.readFileSync("src/panelProvider.ts", "utf8")

test("panel uses CSP-safe delegated click handlers instead of inline onclick", () => {
  assert.doesNotMatch(source, /onclick=/)
  assert.match(source, /document\.addEventListener\('click'/)
  assert.match(source, /dataset\.post/)
  assert.match(source, /dataset\.send/)
  assert.match(source, /dataset\.insert/)
  assert.match(source, /dataset\.permission/)
  assert.match(source, /dataset\.menu/)
  assert.match(source, /dataset\.selectModel/)
  assert.match(source, /dataset\.selectAgent/)
})

test("panel renders controls with data actions for webview postMessage", () => {
  assert.match(source, /data-post="newSession"/)
  assert.match(source, /data-send="true"/)
  assert.match(source, /Ready to start/)
})

test("panel removes command chips and details controls", () => {
  assert.doesNotMatch(source, /data-insert="\/new /)
  assert.doesNotMatch(source, /data-insert="\/agent /)
  assert.doesNotMatch(source, /data-insert="\/diff /)
  assert.doesNotMatch(source, /data-post="resumeSession"/)
  assert.doesNotMatch(source, /data-post="restart"/)
  assert.doesNotMatch(source, /data-post="output"/)
})

test("panel renders model agent and skill menus inline", () => {
  assert.match(source, /data-menu="model"/)
  assert.match(source, /data-menu="agent"/)
  assert.match(source, /data-menu="skill"/)
  assert.match(source, /renderModelMenu/)
  assert.match(source, /renderAgentMenu/)
  assert.match(source, /renderSkillMenu/)
  assert.match(source, /case "loadMenu":/)
})

test("panel sends selected model and agent with prompts", () => {
  assert.match(source, /selectedModel = persisted\.selectedModel/)
  assert.match(source, /selectedAgent = persisted\.selectedAgent/)
  assert.match(source, /post\('sendPrompt', \{ prompt, agent: selectedAgent/)
  assert.match(source, /function isModelPick/)
})

test("panel renders session history and streams opencode events", () => {
  assert.match(source, /renderSessionHistory/)
  assert.match(source, /data-session-id/)
  assert.match(source, /case "selectSession":/)
  assert.match(source, /services\.onDidEvent/)
  assert.match(source, /handleOpenCodeEvent/)
  assert.match(source, /message\.part\.updated/)
})

test("panel preserves draft text and requests initial state after listeners are ready", () => {
  assert.match(source, /let draft = persisted\.draft/)
  assert.match(source, /event\.target\?\.id === 'prompt'/)
  assert.match(source, /post\('ready'\)/)
  assert.match(source, /case "ready":/)
})

test("panel validates and renders permission replies", () => {
  assert.match(source, /function isPermissionMessage/)
  assert.match(source, /msg\.reply === "once"/)
  assert.match(source, /renderPermissions/)
  assert.match(source, /data-permission="reject"/)
})

test("panel uses nonce CSP without unsafe inline styles", () => {
  assert.match(source, /randomBytes\(16\)/)
  assert.match(source, /<style nonce=/)
  assert.doesNotMatch(source, /style-src[^`]*'unsafe-inline'/)
})
