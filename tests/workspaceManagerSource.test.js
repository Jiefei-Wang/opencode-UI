const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const source = fs.readFileSync("src/workspaceManager.ts", "utf8")

test("WorkspaceManager.sync seeds opened folders so the panel can show a workspace before OpenCode starts", () => {
  assert.match(source, /createStoppedRuntime\(folder\)/)
  assert.match(source, /this\.runtimes\.set\(id, createStoppedRuntime\(folder\)/)
})

test("WorkspaceManager surfaces provider stderr failures in runtime snapshots", () => {
  assert.match(source, /runtimeErrorMessage/)
  assert.match(source, /No API key provided/)
  assert.match(source, /rt\.error = message/)
  assert.match(source, /this\.fire\(\)/)
})
