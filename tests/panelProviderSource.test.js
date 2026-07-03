const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")

const source = fs.readFileSync("src/panelProvider.ts", "utf8")

test("panel uses CSP-safe delegated click handlers instead of inline onclick", () => {
  assert.doesNotMatch(source, /onclick=/)
  assert.match(source, /document\.addEventListener\('click'/)
  assert.match(source, /dataset\.insert/)
  assert.match(source, /dataset\.permission/)
  assert.match(source, /dataset\.menu/)
  assert.match(source, /dataset\.selectModel/)
  assert.match(source, /dataset\.selectAgent/)
})

test("panel renders controls with data actions for webview postMessage", () => {
  assert.match(source, /post\('sendPrompt'/)
  assert.match(source, /id="prompt"/)
  assert.match(source, /Ready to start/)
})

test("panel removes command chips and details controls", () => {
  assert.doesNotMatch(source, /data-insert="\/new /)
  assert.doesNotMatch(source, /data-insert="\/agent /)
  assert.doesNotMatch(source, /data-insert="\/diff /)
  assert.doesNotMatch(source, /data-post="resumeSession"/)
  assert.doesNotMatch(source, /data-post="output"/)
})

test("panel renders model agent and skill menus inline", () => {
  assert.match(source, /data-menu="model"/)
  assert.doesNotMatch(source, /Use OpenCode default model/)
  assert.match(source, /Recent models/)
  assert.match(source, /byProvider/)
  assert.match(source, /data-menu="agent"/)
  assert.match(source, /data-menu="skill"/)
  assert.match(source, /renderModelMenu/)
  assert.match(source, /renderAgentMenu/)
  assert.match(source, /renderSkillMenu/)
  assert.match(source, /case "loadMenu":/)
})

test("panel highlights model menu category headers", () => {
  assert.match(source, /\.menu-title\.model-category/)
  assert.match(source, /\.model-category\.recent/)
  assert.match(source, /\.model-category\.provider/)
  assert.match(source, /class="menu-title model-category recent">Recent models/)
  assert.match(source, /class="menu-title model-category provider">' \+ esc\(provider\) \+ '<\/div>/)
  assert.match(source, /var\(--vscode-charts-purple, #c586f1\)/)
})

test("panel sends selected model and agent with prompts", () => {
  assert.match(source, /selectedModel = persisted\.selectedModel/)
  assert.match(source, /selectedModel = ws\?\.selectedModel \|\| null/)
  assert.match(source, /selectedAgent = persisted\.selectedAgent/)
  assert.match(source, /post\('sendPrompt', \{ prompt, agent: selectedAgent/)
  assert.match(source, /post\('setModel'/)
  assert.match(source, /modelButtonLabel/)
  assert.match(source, /agentButtonLabel/)
  assert.match(source, /function isModelPick/)
})

test("panel agent picker mirrors model label and can clear selection", () => {
  assert.match(source, /\$\{esc\(agentButtonLabel\(\)\)\}/)
  assert.match(source, /function agentButtonLabel\(\) \{ return selectedAgent \|\| 'Agent'; \}/)
  assert.match(source, />None<span class="meta">Use OpenCode default agent<\/span>/)
  assert.match(source, /data-clear-agent="true"/)
  assert.match(source, /button\.dataset\.clearAgent/)
  assert.match(source, /agent: selectedAgent \|\| undefined/)
  assert.doesNotMatch(source, /renderSelection/)
  assert.doesNotMatch(source, /data-clear-selection/)
  assert.doesNotMatch(source, /Agent: @/)
})

test("panel renders session history and streams opencode events", () => {
  assert.match(source, /renderSessionHistory/)
  assert.match(source, /data-session-id/)
  assert.match(source, /data-toggle-history="true"/)
  assert.match(source, /sessionListOpen/)
  assert.match(source, /case "selectSession":/)
  assert.match(source, /services\.onDidEvent/)
  assert.match(source, /handleOpenCodeEvent/)
  assert.match(source, /message\.part\.updated/)
})

test("panel compact session bar only expands history after prompting", () => {
  assert.match(source, /function renderTopBar\(ws, hasPrompted\)/)
  assert.match(source, /currentSessionLabel/)
  assert.match(source, /<span class="name">/)
  assert.match(source, /<span class="status">Click to switch sessions<\/span>/)
  assert.doesNotMatch(source, /data-session-actions="true"/)
  assert.doesNotMatch(source, /function renderSessionActions/)
})

test("panel closes and persists session history when a session is selected", () => {
  assert.match(source, /if \(button\.dataset\.sessionId\)/)
  assert.match(source, /sessionListOpen = false; save\(\); render\(\); post\('selectSession'/)
})

test("panel ignores user-role message part events so sent prompts are not duplicated as assistant text", () => {
  assert.match(source, /const messageRoles = new Map\(\);/)
  assert.match(source, /event\.type === 'message\.updated'/)
  assert.match(source, /messageRoles\.set\(props\.info\.id, props\.info\.role\)/)
  assert.match(source, /messageID = props\.messageID \|\| part\.messageID/)
  assert.match(source, /messageID && messageRoles\.get\(messageID\) === 'assistant'/)
  assert.doesNotMatch(source, /props\.info\?\.role === 'assistant' \|\| props\.info\?\.role === undefined/)
})

test("panel renders thinking separately in a collapsed expandable disclosure", () => {
  assert.match(source, /\.thinking \{ max-width:/)
  assert.match(source, /function renderThinking\(msg\)/)
  assert.match(source, /<details class="thinking">/)
  assert.match(source, /<summary>Thinking<\/summary>/)
  assert.doesNotMatch(source, /<details class="thinking" open>/)
  assert.match(source, /function appendThinking\(text\)/)
  assert.match(source, /part\.type === 'reasoning'/)
})

test("panel escapes thinking preview line splitting for the embedded webview script", () => {
  assert.match(source, /split\(\/\\\\r\?\\\\n\/\)/)
  assert.match(source, /join\('\\\\n'\)/)
  assert.doesNotMatch(source, /split\(\/\\r\?\\n\/\)\.filter\(Boolean\)\.slice\(-3\)\.join\('\\n'\)/)
})

test("panel keeps composer usable in narrow panes and surfaces runtime errors", () => {
  assert.match(source, /grid-template-columns: minmax\(0, 1fr\) auto/)
  assert.match(source, /@media \(max-width: 360px\)/)
  assert.match(source, /@media \(min-width: 520px\)/)
  assert.match(source, /\.composer-row \.send \{ display: none; \}/)
  assert.match(source, /\.composer-wrap \{ min-width: 0;/)
  assert.match(source, /surfaceWorkspaceError/)
  assert.match(source, /appendNotice\(ws\.error, 'error'\)/)
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
