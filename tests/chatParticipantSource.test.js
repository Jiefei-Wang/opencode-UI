const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const source = fs.readFileSync("src/chatParticipant.ts", "utf8")

test("chat participant ignores user-role message part events so VS Code Chat does not echo prompts", () => {
  assert.match(source, /function isAssistantMessageEvent\(props: any\)/)
  assert.match(source, /if \(!isAssistantMessageEvent\(props\)\) return/)
  assert.match(source, /props\.info\?\.role === "assistant"/)
})
