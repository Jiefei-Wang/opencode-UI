const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const source = fs.readFileSync("src/services.ts", "utf8")

test("services persist and restore selected OpenCode model", () => {
  assert.match(source, /private selectedModel\?: ModelPick/)
  assert.match(source, /modelStateKey\(\)/)
  assert.match(source, /globalState\.update\(modelStateKey\(\)/)
  assert.match(source, /restoreSelectedModel\(models\)/)
  assert.match(source, /recentModelStateKey\(\)/)
  assert.match(source, /recordRecentModel/)
})

test("services use OpenCode default when no model is selected", () => {
  assert.match(source, /this\.selectedModel \?\? parseModel\(defaultModel\(\)\)/)
  assert.match(source, /<opencode-default>/)
})

test("services load models from connected config providers", () => {
  assert.match(source, /connectedProvidersFromConfig/)
  assert.match(source, /modelsFromConnectedProviders/)
  assert.match(source, /client\?\.config\?\.providers/)
  assert.doesNotMatch(source, /client\?\.provider\?\.list/)
})

test("services snapshot exposes the OpenCode session list loaded for each workspace", () => {
  assert.match(source, /sessions: this\.sessions\.get\(rt\.workspaceId\) \?\? \[\]/)
  assert.match(source, /return list/)
  assert.match(source, /rt\.client\.session\.list\(\{ directory: rt\.dir, roots: true \}\)/)
})

test("services log detailed session refresh diagnostics", () => {
  assert.match(source, /refreshSessions start workspaceId=/)
  assert.match(source, /refreshSessions result count=/)
  assert.match(source, /session id=\$\{session\.id\}/)
  assert.match(source, /snapshotCount=/)
})
