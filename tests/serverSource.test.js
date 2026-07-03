const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const source = fs.readFileSync("src/server.ts", "utf8")

test("server launches with OpenCode caller environment", () => {
  assert.match(source, /OPENCODE_CALLER: "opencode"/)
})
