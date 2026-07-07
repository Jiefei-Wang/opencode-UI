import * as vscode from "vscode"
import { randomBytes } from "node:crypto"
import { collectEditorContext, collectPinnedFileContexts, collectPinnedFolderContexts, composePromptText, type PromptContextItem } from "./promptContext"
import { OpenCodeServices } from "./services"

export class OpenCodePanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView
  private readonly changeSub: vscode.Disposable
  private readonly eventSub: vscode.Disposable
  private viewSub?: vscode.Disposable
  private contextSubs: vscode.Disposable[] = []
  private htmlTemplate?: Thenable<string>

  /**
   * Creates the panel provider and subscribes it to service state/event changes.
   * Input: VS Code extension context and the OpenCode service facade.
   * Return: a provider instance; constructors do not return explicit values.
   */
  constructor(
    private ctx: vscode.ExtensionContext,
    private services: OpenCodeServices,
    private out: vscode.OutputChannel,
  ) {
    this.changeSub = this.services.onDidChange(() => this.postState())
    this.eventSub = this.services.onDidEvent(({ workspaceId, event }) => this.postEvent(workspaceId, event))
  }

  /**
   * Initializes the VS Code webview when the OpenCode side panel is shown.
   * Input: the webview view created by VS Code.
   * Return: void; it configures the webview, wires message handling, and posts initial state.
   */
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    view.webview.options = { enableScripts: true }
    this.viewSub?.dispose()
    this.viewSub = view.webview.onDidReceiveMessage((msg) => void this.handleMessage(msg))
    this.resetContextListeners()
    void this.initializeWebview(view.webview)
  }

  /**
   * Loads the webview document, assigns it to VS Code, and posts initial state.
   * Input: the webview that will display the panel HTML.
   * Return: a promise that resolves after the initial panel refresh has been requested.
   */
  private async initializeWebview(webview: vscode.Webview) {
    try {
      webview.html = await this.html(webview)
      this.postState()
      this.postEditorContext()
      void this.refreshPanelState()
    } catch (err) {
      webview.html = this.errorHtml(err)
    }
  }

  /**
   * Releases event subscriptions owned by the panel provider.
   * Input: none.
   * Return: void.
   */
  dispose() {
    this.changeSub.dispose()
    this.eventSub.dispose()
    this.viewSub?.dispose()
    this.disposeContextListeners()
  }

  /**
   * Handles messages sent from the webview UI to the extension host.
   * Input: a message object posted by the webview script.
   * Return: a promise that resolves after the requested command/service action completes.
   */
  private async handleMessage(msg: any) {
    try {
      switch (msg?.type) {
        case "openChat":
          await vscode.commands.executeCommand("opencode.openChat")
          break
        case "newSession":
          await vscode.commands.executeCommand("opencode.newSession")
          break
        case "resumeSession":
          await vscode.commands.executeCommand("opencode.resumeSession")
          break
        case "selectSession":
          if (typeof msg.workspaceId === "string" && typeof msg.sessionID === "string") {
            await this.services.selectSession(msg.workspaceId, msg.sessionID)
          }
          break
        case "pickAgent":
          await vscode.commands.executeCommand("opencode.pickAgent")
          break
        case "pickSkill":
          await vscode.commands.executeCommand("opencode.pickSkill")
          break
        case "pickModel":
          await vscode.commands.executeCommand("opencode.pickModel")
          break
        case "addContext":
          await this.handleAddContextMessage(msg)
          break
        case "abort":
          await vscode.commands.executeCommand("opencode.abort")
          break
        case "restart":
          await vscode.commands.executeCommand("opencode.restartServer")
          break
        case "check":
          await vscode.commands.executeCommand("opencode.checkEnvironment")
          break
        case "output":
          await vscode.commands.executeCommand("opencode.openOutput")
          break
        case "copy":
          if (typeof msg.text === "string") await vscode.env.clipboard.writeText(msg.text)
          break
        case "loadMenu": {
          const rt = await this.services.ensureReady()
          if (msg.menu === "agent") await this.services.listAgents(rt)
          if (msg.menu === "skill") await this.services.listSkills(rt)
          if (msg.menu === "model") await this.services.listModels(rt)
          break
        }
        case "setModel":
          await this.services.setSelectedModel(isModelPick(msg.model) ? msg.model : undefined)
          break
        case "permission":
          if (isPermissionMessage(msg)) {
            await this.services.replyPermission(msg.workspaceId, msg.requestID, msg.reply)
          }
          break
        case "ready":
          await this.services.refreshCurrent()
          this.postEditorContext()
          break
        case "refreshSessions":
          await this.refreshPanelState()
          return
        case "requestContext":
          this.postEditorContext()
          break
        case "sendPrompt": {
          if (typeof msg.prompt === "string" && msg.prompt.trim()) {
            const manualContexts = normalizeContextItems(msg.contextItems)
            const liveContext = collectEditorContext().items
            const prompt = composePromptText(msg.prompt, [...manualContexts, ...liveContext])
            await this.services.sendPrompt(prompt, {
              agent: typeof msg.agent === "string" ? msg.agent : undefined,
              model: isModelPick(msg.model) ? msg.model : undefined,
            })
          }
          break
        }
      }
      this.postState()
      this.postEditorContext()
    } catch (err) {
      this.postNotice("error", err instanceof Error ? err.message : String(err))
      this.postState()
      this.postEditorContext()
    }
  }

  /**
   * Sends the latest workspace snapshot to the webview.
   * Input: none; the snapshot is read from OpenCodeServices.
   * Return: void.
   */
  private postState() {
    const workspaces = this.services.snapshot()
    void this.view?.webview.postMessage({ type: "state", workspaces })
    const ws = workspaces[0]
    const serverState = !ws ? "" : ws.error ? "error" : ws.state ?? ""
    void vscode.commands.executeCommand("setContext", "opencode.serverState", serverState)
  }

  /**
   * Sends a transient status or error notice to the webview.
   * Input: notice level and display text.
   * Return: void.
   */
  private postNotice(level: "sent" | "error", text: string) {
    void this.view?.webview.postMessage({ type: "notice", level, text })
  }

  /**
   * Forwards an OpenCode session event to the webview.
   * Input: workspace id and raw OpenCode event payload.
   * Return: void.
   */
  private postEvent(workspaceId: string, event: any) {
    void this.view?.webview.postMessage({ type: "event", workspaceId, event })
  }

  /**
   * Sends the current live editor context snapshot to the panel webview.
   * Input: none; context is gathered from the active editor.
   * Return: void.
   */
  private postEditorContext() {
    const context = collectEditorContext()
    void this.view?.webview.postMessage({ type: "contextState", context })
  }

  /**
   * Hooks VS Code editor events so the webview can keep its live context chips current.
   * Input: none.
   * Return: void.
   */
  private resetContextListeners() {
    this.disposeContextListeners()
    const refresh = () => this.postEditorContext()
    this.contextSubs = [
      vscode.window.onDidChangeActiveTextEditor(refresh),
      vscode.window.onDidChangeTextEditorSelection(refresh),
      vscode.window.onDidChangeTextEditorVisibleRanges(refresh),
      vscode.workspace.onDidChangeTextDocument(refresh),
    ]
    this.postEditorContext()
  }

  private disposeContextListeners() {
    for (const sub of this.contextSubs) sub.dispose()
    this.contextSubs = []
  }

  private async handleAddContextMessage(msg: any) {
    const kind = typeof msg?.kind === "string" ? msg.kind : ""
    if (kind === "active-file" || kind === "selection") {
      const context = collectEditorContext()
      const item = context.items.find((entry) => entry.kind === kind)
      if (item) {
        void this.view?.webview.postMessage({ type: "contextAdded", items: [pinContextItem(item)] })
      } else {
        this.postNotice("error", kind === "selection" ? "No selection to pin." : "No active file to pin.")
      }
      return
    }

    if (kind === "file") {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFolders: false, canSelectFiles: true, openLabel: "Add file context" })
      if (!picked?.length) return
      const items = await collectPinnedFileContexts(picked)
      void this.view?.webview.postMessage({ type: "contextAdded", items: items.map(toWebviewContextItem) })
      return
    }

    if (kind === "folder") {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFolders: true, canSelectFiles: false, openLabel: "Add folder context" })
      if (!picked?.length) return
      const items = await collectPinnedFolderContexts(picked)
      void this.view?.webview.postMessage({ type: "contextAdded", items: items.map(toWebviewContextItem) })
      return
    }

    this.postNotice("error", `Unknown context action: ${kind || "<missing>"}`)
  }

  /**
   * Refreshes current OpenCode data and then republishes panel state.
   * Input: none.
   * Return: a promise that resolves after refresh/posting finishes.
   */
  private async refreshPanelState() {
    const message = "Refreshing OpenCode sessions..."
    // this.postNotice("sent", message)
    this.out.appendLine(`[panel] ${message}`)
    try {
      await this.services.refreshCurrent()
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
    //   this.postNotice("error", errorText)
      this.out.appendLine(`[panel] refresh failed: ${errorText}`)
    } finally {
      this.postState()
    }
  }

  /**
   * Builds the complete HTML, CSS, and client-side script for the webview.
   * Input: the VS Code webview used for CSP source values.
   * Return: a promise for an HTML document string.
   */
  private html(webview: vscode.Webview) {
    const nonce = randomBytes(16).toString("base64")
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`
    return this.loadHtmlTemplate()
      .then((template) => template.replaceAll("{{CSP}}", csp).replaceAll("{{NONCE}}", nonce))
  }

  /**
   * Reads and caches the static panel HTML file shipped with the extension.
   * Input: none; the file path is derived from the extension install directory.
   * Return: a promise for the raw HTML template.
   */
  private loadHtmlTemplate() {
    this.htmlTemplate ??= vscode.workspace.fs
      .readFile(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "panel.html"))
      .then((bytes) => new TextDecoder().decode(bytes))
    return this.htmlTemplate
  }

  /**
   * Builds a minimal fallback page when the static panel file cannot be loaded.
   * Input: the read/render error.
   * Return: an HTML document string with the escaped error message.
   */
  private errorHtml(err: unknown) {
    return `<!doctype html><body style="font-family: sans-serif; padding: 12px;">OpenCode panel failed to load: ${escapeHtml(err instanceof Error ? err.message : String(err))}</body>`
  }
}

/**
 * Escapes plain text for use in a minimal HTML fallback.
 * Input: untrusted display text.
 * Return: HTML-escaped text.
 */
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!)
}

/**
 * Checks whether a webview message is a valid permission reply.
 * Input: unknown message payload from the webview.
 * Return: true when the payload has workspace id, request id, and an accepted reply value.
 */
function isPermissionMessage(msg: any): msg is { workspaceId: string; requestID: string; reply: "once" | "always" | "reject" } {
  return typeof msg?.workspaceId === "string"
    && typeof msg?.requestID === "string"
    && (msg.reply === "once" || msg.reply === "always" || msg.reply === "reject")
}

/**
 * Checks whether a value contains the minimum fields needed to select a model.
 * Input: unknown value from persisted state or webview message data.
 * Return: true when providerID, modelID, and label are strings.
 */
function isModelPick(value: any): value is { providerID: string; modelID: string; label: string } {
  return typeof value?.providerID === "string"
    && typeof value?.modelID === "string"
    && typeof value?.label === "string"
}

function normalizeContextItems(value: unknown): PromptContextItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const candidate = item as PromptContextItem
    if (typeof candidate.id !== "string" || typeof candidate.kind !== "string" || typeof candidate.priority !== "string" || typeof candidate.title !== "string") return []
    return [candidate]
  })
}

function toWebviewContextItem(item: PromptContextItem) {
  return { ...item, payload: { ...item.payload } }
}

function pinContextItem(item: PromptContextItem): PromptContextItem {
  return {
    ...item,
    source: "pinned",
    priority: "very-high",
    removable: true,
    id: `pinned:${item.id}`,
  }
}
