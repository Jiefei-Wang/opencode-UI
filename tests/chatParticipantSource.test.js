const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const source = fs.readFileSync("src/chatParticipant.ts", "utf8")

test("chat participant ignores user-role message part events so VS Code Chat does not echo prompts", () => {
  assert.match(source, /const messageRoles = new Map<string, "user" \| "assistant">\(\)/)
  assert.match(source, /event\.type === "message\.updated"/)
  assert.match(source, /messageRoles\.set\(props\.info\.id, props\.info\.role\)/)
  assert.match(source, /messageID = props\.messageID \?\? props\.part\?\.messageID/)
  assert.match(source, /messageID && messageRoles\.get\(messageID\) === "assistant"/)
  assert.doesNotMatch(source, /props\.info\?\.role === "assistant" \|\| props\.info\?\.role === undefined/)
})

test("chat participant renders reasoning as collapsed thinking details separate from answer text", () => {
  assert.match(source, /part\?\.type === "reasoning"/)
  assert.match(source, /<details><summary>Thinking<\/summary>/)
  assert.match(source, /<\/details>/)
})
