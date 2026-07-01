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
  assert.match(source, /dataset\.details/)
})

test("panel renders controls with data actions for webview postMessage", () => {
  assert.match(source, /data-post="newSession"/)
  assert.match(source, /data-post="restart"/)
  assert.match(source, /data-send="true"/)
  assert.match(source, /data-insert="\/new /)
  assert.match(source, /Starting OpenCode and sending your request/)
  assert.match(source, /Ready to start/)
})
