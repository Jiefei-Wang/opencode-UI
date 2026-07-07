const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test")
const vm = require("node:vm")

const panelHtml = fs.readFileSync("media/panel.html", "utf8")

function renderPanelHtml() {
  assert.match(panelHtml, /<!doctype html>/, "panel HTML template should exist")
  return panelHtml.replaceAll("{{NONCE}}", "nonce").replaceAll("{{CSP}}", "csp")
}

function createPanelHarness(initialState = {}) {
  const html = renderPanelHtml()
  const scriptMatch = html.match(/<script nonce="[^"]*">([\s\S]*)<\/script>/)
  assert.ok(scriptMatch, "panel webview script should exist")

  const postedMessages = []
  let persistedState = initialState
  let windowMessageHandler = undefined

  let activeElement = null
  let promptElement = null
  let menuListElement = null
  let messagesElement = null

  function createPromptElement(initialValue) {
    return {
      id: "prompt",
      value: initialValue,
      selectionStart: 0,
      selectionEnd: 0,
      addEventListener() {},
      focus() {
        activeElement = this
      },
      setSelectionRange(start, end) {
        this.selectionStart = start
        this.selectionEnd = end
      },
    }
  }

  function updateRenderedElements(markup) {
    const promptMatch = markup.match(/<textarea id="prompt"[^>]*>([\s\S]*?)<\/textarea>/)
    promptElement = promptMatch ? createPromptElement(promptMatch[1]) : null

    menuListElement = markup.includes('class="menu-list"')
      ? { scrollTop: 0 }
      : null

    messagesElement = markup.includes('class="messages"')
      ? { scrollHeight: 0, scrollTo() {} }
      : null

    activeElement = null
  }

  const appElement = {
    _innerHTML: "",
    get innerHTML() {
      return this._innerHTML
    },
    set innerHTML(value) {
      this._innerHTML = value
      updateRenderedElements(value)
    },
    querySelector(selector) {
      if (selector === ".messages") return messagesElement
      if (selector === ".menu-list") return menuListElement
      return null
    },
  }

  const document = {
    get activeElement() {
      return activeElement
    },
    getElementById(id) {
      if (id === "app") return appElement
      if (id === "prompt") return promptElement
      return null
    },
    querySelector(selector) {
      if (selector === ".menu-list") return menuListElement
      return null
    },
    addEventListener() {},
  }

  const window = {
    addEventListener(type, handler) {
      if (type === "message") windowMessageHandler = handler
    },
  }

  const vscode = {
    getState() {
      return persistedState
    },
    setState(nextState) {
      persistedState = nextState
    },
    postMessage(message) {
      postedMessages.push(message)
    },
  }

  const context = vm.createContext({
    acquireVsCodeApi: () => vscode,
    document,
    window,
    console,
    setTimeout,
    clearTimeout,
  })

  vm.runInContext(scriptMatch[1], context)
  assert.ok(windowMessageHandler, "panel should register a window message handler")

  return {
    appElement,
    postedMessages,
    getPersistedState() {
      return persistedState
    },
    getPrompt() {
      return promptElement
    },
    getMenuList() {
      return menuListElement
    },
    dispatch(data) {
      windowMessageHandler({ data })
    },
  }
}

test("panel runtime keeps lightweight reasoning deltas out of the assistant reply bubble", () => {
  const harness = createPanelHarness()
  const workspace = {
    workspaceId: "ws-1",
    activeSessionId: "ses-1",
    state: "ready",
    selectedModel: null,
    permissions: [],
    sessions: [],
  }
  const thinking = "The user is just saying \"hi\" again. I should keep it simple and ask what they need help with. No tools needed for this."
  const reply = "What do you need?"

  harness.dispatch({ type: "state", workspaces: [workspace] })
  harness.dispatch({
    type: "event",
    workspaceId: workspace.workspaceId,
    event: {
      type: "message.updated",
      properties: { info: { id: "msg-1", role: "assistant", sessionID: workspace.activeSessionId } },
    },
  })
  harness.dispatch({
    type: "event",
    workspaceId: workspace.workspaceId,
    event: {
      type: "message.part.delta",
      properties: { sessionID: workspace.activeSessionId, messageID: "msg-1", partID: "prt-reason", field: "text", delta: thinking },
    },
  })
  harness.dispatch({
    type: "event",
    workspaceId: workspace.workspaceId,
    event: {
      type: "message.part.updated",
      properties: {
        sessionID: workspace.activeSessionId,
        part: { id: "prt-reason", messageID: "msg-1", sessionID: workspace.activeSessionId, type: "reasoning", text: thinking },
      },
    },
  })
  harness.dispatch({
    type: "event",
    workspaceId: workspace.workspaceId,
    event: {
      type: "message.part.delta",
      properties: { sessionID: workspace.activeSessionId, messageID: "msg-1", partID: "prt-text", field: "text", delta: reply },
    },
  })
  harness.dispatch({
    type: "event",
    workspaceId: workspace.workspaceId,
    event: {
      type: "message.part.updated",
      properties: {
        sessionID: workspace.activeSessionId,
        part: { id: "prt-text", messageID: "msg-1", sessionID: workspace.activeSessionId, type: "text", text: reply },
      },
    },
  })

  assert.match(harness.appElement.innerHTML, /<details class="thinking">/)
  assert.match(harness.appElement.innerHTML, /<div class="bubble ">What do you need\?<\/div>/)
  assert.doesNotMatch(
    harness.appElement.innerHTML,
    /<div class="bubble ">The user is just saying[\x00-\x7F\s\S]*What do you need\?<\/div>/,
  )
})

test("panel runtime restores prompt focus and caret across state rerenders", () => {
  const harness = createPanelHarness()
  const workspace = {
    workspaceId: "ws-1",
    activeSessionId: "ses-1",
    state: "ready",
    selectedModel: null,
    permissions: [],
    sessions: [],
  }

  harness.dispatch({ type: "state", workspaces: [workspace] })
  const promptBefore = harness.getPrompt()
  assert.ok(promptBefore, "prompt should render after initial state")
  promptBefore.value = "draft message"
  promptBefore.focus()
  promptBefore.setSelectionRange(2, 7)

  harness.dispatch({ type: "state", workspaces: [workspace] })

  const promptAfter = harness.getPrompt()
  assert.ok(promptAfter, "prompt should still exist after rerender")
  assert.notStrictEqual(promptAfter, promptBefore, "rerender should recreate the prompt element in the harness")
  assert.equal(promptAfter.value, "draft message")
  assert.equal(promptAfter.selectionStart, 2)
  assert.equal(promptAfter.selectionEnd, 7)
  assert.strictEqual(promptAfter, harness.getPrompt())
  assert.equal(harness.getPersistedState().draft, "draft message")
})

test("panel runtime restores open model menu scroll across state rerenders", () => {
  const harness = createPanelHarness({ menuOpen: "model" })
  const workspace = {
    workspaceId: "ws-1",
    activeSessionId: "ses-1",
    state: "ready",
    selectedModel: null,
    permissions: [],
    sessions: [],
    recentModels: [],
    models: [
      { providerID: "openai", providerName: "OpenAI", modelID: "gpt-5.4", name: "GPT-5.4", label: "GPT-5.4" },
      { providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", name: "GPT-4.1", label: "GPT-4.1" },
    ],
  }

  harness.dispatch({ type: "state", workspaces: [workspace] })
  const menuBefore = harness.getMenuList()
  assert.ok(menuBefore, "model menu should render when menuOpen is persisted")
  menuBefore.scrollTop = 144

  harness.dispatch({ type: "state", workspaces: [workspace] })

  const menuAfter = harness.getMenuList()
  assert.ok(menuAfter, "model menu should still exist after rerender")
  assert.notStrictEqual(menuAfter, menuBefore, "rerender should recreate the menu list in the harness")
  assert.equal(menuAfter.scrollTop, 144)
})

test("panel runtime renders existing session history in the startup top bar", () => {
  const harness = createPanelHarness()
  const workspace = {
    workspaceId: "ws-1",
    activeSessionId: "ses-1",
    state: "ready",
    selectedModel: null,
    permissions: [],
    sessions: [
      { id: "ses-1", title: "OpenCode session", time: { updated: 2 } },
      { id: "ses-2", title: "Greeting", time: { updated: 1 } },
    ],
  }

  harness.dispatch({ type: "state", workspaces: [workspace] })

  assert.match(harness.appElement.innerHTML, /OpenCode session/)
  assert.match(harness.appElement.innerHTML, /Greeting/)
  assert.match(harness.appElement.innerHTML, /Sessions/)
})

test("panel runtime requests a refresh when ready workspace history is empty", () => {
  const harness = createPanelHarness()
  const workspace = {
    workspaceId: "ws-1",
    name: "lecture 7",
    dir: "G:\\My Drive\\teaching\\Introductory Statistical Programming with R\\slides\\lecture 7",
    state: "ready",
    selectedModel: null,
    permissions: [],
    sessions: [],
  }

  harness.dispatch({ type: "state", workspaces: [workspace] })

  assert.ok(harness.postedMessages.some((message) => message.type === "refreshSessions"), "ready empty history should request refresh")
})

test("panel runtime renders live and pinned context chips above the prompt", () => {
  const harness = createPanelHarness()
  const workspace = {
    workspaceId: "ws-1",
    activeSessionId: "ses-1",
    state: "ready",
    selectedModel: null,
    permissions: [],
    sessions: [],
  }

  harness.dispatch({ type: "state", workspaces: [workspace] })
  harness.dispatch({
    type: "contextState",
    context: {
      items: [
        { id: "live:active-file:file:///workspace/src/app.ts", source: "live", kind: "active-file", priority: "low", title: "app.ts", detail: "L1", removable: false, payload: { path: "src/app.ts", uri: "file:///workspace/src/app.ts" } },
      ],
      canAddActiveFile: true,
      canAddSelection: true,
      canAddFile: true,
      canAddFolder: true,
    },
  })
  harness.dispatch({
    type: "contextAdded",
    items: [
      { id: "pinned:manual:file:///workspace/README.md", source: "pinned", kind: "file", priority: "very-high", title: "README.md", detail: "md", removable: true, payload: { path: "README.md", uri: "file:///workspace/README.md" } },
    ],
  })

  assert.match(harness.appElement.innerHTML, /<div class="context-bar">/)
  assert.match(harness.appElement.innerHTML, /<button class="context-add" data-menu="context" aria-label="Add context">\+<\/button>/)
  assert.match(harness.appElement.innerHTML, /app\.ts:L1/)
  assert.match(harness.appElement.innerHTML, /README\.md/)
  assert.match(harness.appElement.innerHTML, /data-source="live"/)
  assert.match(harness.appElement.innerHTML, /data-source="pinned"/)
  assert.doesNotMatch(harness.appElement.innerHTML, /<div class="context-bar-title">Context<\/div>/)
  assert.doesNotMatch(harness.appElement.innerHTML, />auto</)
})
