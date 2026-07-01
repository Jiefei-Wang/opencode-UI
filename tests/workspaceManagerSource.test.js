const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const source = fs.readFileSync("src/workspaceManager.ts", "utf8")

test("WorkspaceManager.sync seeds opened folders so the panel can show a workspace before OpenCode starts", () => {
  assert.match(source, /createStoppedRuntime\(folder\)/)
  assert.match(source, /this\.runtimes\.set\(id, createStoppedRuntime\(folder\)/)
})
