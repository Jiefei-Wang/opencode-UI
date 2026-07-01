import * as vscode from "vscode"
import { OpenCodeServices } from "./services"

export class OpenCodePanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView

  constructor(private ctx: vscode.ExtensionContext, private services: OpenCodeServices) {
    this.services.onDidChange(() => this.postState())
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = this.html(view.webview)
    view.webview.onDidReceiveMessage((msg) => void this.handleMessage(msg))
    this.postState()
  }

  dispose() {}

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
        case "pickAgent":
          await vscode.commands.executeCommand("opencode.pickAgent")
          break
        case "pickSkill":
          await vscode.commands.executeCommand("opencode.pickSkill")
          break
        case "pickModel":
          await vscode.commands.executeCommand("opencode.pickModel")
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
        case "sendPrompt":
          if (typeof msg.prompt === "string" && msg.prompt.trim()) {
            await this.services.sendPrompt(msg.prompt.trim())
            this.postNotice("sent", "OpenCode is working on your request.")
          }
          break
        case "permission":
          await this.services.replyPermission(msg.workspaceId, msg.requestID, msg.reply)
          break
      }
      this.postState()
    } catch (err) {
      this.postNotice("error", err instanceof Error ? err.message : String(err))
      this.postState()
    }
  }

  private postState() {
    void this.view?.webview.postMessage({ type: "state", workspaces: this.services.snapshot() })
  }

  private postNotice(level: "sent" | "error", text: string) {
    void this.view?.webview.postMessage({ type: "notice", level, text })
  }

  private html(webview: vscode.Webview) {
    const nonce = String(Date.now())
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    html, body, #app { height: 100%; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    button, textarea { font: inherit; }
    button { border: 0; border-radius: 5px; color: var(--vscode-foreground); background: transparent; cursor: pointer; }
    button:hover { background: var(--vscode-toolbar-hoverBackground); }
    button.primary { min-width: 52px; padding: 4px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.subtle { padding: 3px 7px; color: var(--vscode-descriptionForeground); }
    textarea { width: 100%; min-height: 62px; max-height: 170px; padding: 9px 10px 2px; border: 0; outline: 0; resize: vertical; color: var(--vscode-input-foreground); background: transparent; line-height: 1.45; }
    .shell { height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 10px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .workspace { min-width: 0; }
    .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar { display: flex; gap: 2px; flex: 0 0 auto; }
    .messages { min-height: 0; overflow-y: auto; padding: 14px 10px; }
    .empty { height: 100%; display: grid; align-content: center; justify-items: center; gap: 7px; text-align: center; color: var(--vscode-descriptionForeground); padding: 20px; }
    .empty-title { color: var(--vscode-foreground); font-size: 15px; font-weight: 600; }
    .message { margin: 0 0 12px; }
    .message.user { display: flex; justify-content: flex-end; }
    .bubble { max-width: 92%; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); white-space: pre-wrap; overflow-wrap: anywhere; }
    .user .bubble { background: color-mix(in srgb, var(--vscode-button-background) 14%, var(--vscode-editor-background)); }
    .assistant .bubble { border-top-left-radius: 3px; }
    .notice { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .notice.error { color: var(--vscode-errorForeground); }
    .details { margin-top: 12px; border-top: 1px solid var(--vscode-panel-border); padding-top: 10px; display: none; }
    .details.open { display: block; }
    .detail-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .detail-row button { padding: 3px 7px; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); }
    .composer-wrap { padding: 8px 10px 10px; border-top: 1px solid var(--vscode-panel-border); }
    .composer { border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 10px; background: var(--vscode-input-background); overflow: hidden; }
    .composer:focus-within { border-color: var(--vscode-focusBorder); }
    .composer-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px; }
    .quick { display: flex; gap: 3px; overflow-x: auto; }
    .send { display: flex; gap: 4px; flex: 0 0 auto; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const persisted = vscode.getState?.() || {};
    let workspaces = persisted.workspaces || [];
    let messages = persisted.messages || [];
    let notice = persisted.notice || '';
    let noticeLevel = persisted.noticeLevel || 'sent';
    let detailsOpen = persisted.detailsOpen || false;

    window.addEventListener('message', event => {
      if (event.data?.type === 'state') {
        workspaces = event.data.workspaces || [];
        save();
        render();
      }
      if (event.data?.type === 'notice') {
        notice = event.data.text || '';
        noticeLevel = event.data.level || 'sent';
        if (notice) messages.push({ role: 'assistant', text: notice, kind: noticeLevel });
        save();
        render();
      }
    });

    function post(type, data = {}) { vscode.postMessage({ type, ...data }); }
    function save() { vscode.setState?.({ workspaces, messages, notice, noticeLevel, detailsOpen }); }
    function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
    function statusText(ws) {
      if (!ws) return 'Open a folder to start';
      if (ws.error) return 'Needs attention';
      if (ws.state === 'stopped') return 'Ready to start';
      if (ws.state === 'starting') return 'Starting OpenCode';
      if (ws.state === 'ready') return 'Ready';
      if (ws.state === 'busy') return 'Working';
      return ws.state || 'Ready';
    }
    function render() {
      const app = document.getElementById('app');
      const ws = workspaces[0];
      app.innerHTML = \`
        <div class="shell">
          <header class="header">
            <div class="workspace">
              <div class="name">\${ws ? esc(ws.name || ws.dir || 'Workspace') : 'OpenCode'}</div>
              <div class="status">\${esc(statusText(ws))}\${ws?.dir ? ' · ' + esc(ws.dir) : ''}</div>
            </div>
            <div class="toolbar">
              <button class="subtle" title="New session" data-post="newSession">+</button>
              <button class="subtle" title="Stop" data-post="abort">Stop</button>
              <button class="subtle" title="Details" data-details="true">...</button>
            </div>
          </header>
          <main class="messages">
            \${messages.length ? renderMessages() : renderEmpty(ws)}
            <section class="details \${detailsOpen ? 'open' : ''}">
              <div class="notice">\${ws?.error ? esc(ws.error) : 'Session tools'}</div>
              <div class="detail-row">
                <button data-post="pickModel">Model</button>
                <button data-post="pickAgent">Agent</button>
                <button data-post="pickSkill">Skill</button>
                <button data-post="resumeSession">Resume</button>
                <button data-post="restart">Restart</button>
                <button data-post="output">Output</button>
              </div>
            </section>
          </main>
          <footer class="composer-wrap">
            <div class="composer">
              <textarea id="prompt" placeholder="Ask OpenCode to build, explain, debug, or refactor..."></textarea>
              <div class="composer-actions">
                <div class="quick">
                  <button class="subtle" data-insert="/new ">/new</button>
                  <button class="subtle" data-insert="/agent ">/agent</button>
                  <button class="subtle" data-insert="/diff ">/diff</button>
                </div>
                <div class="send"><button class="primary" data-send="true">Send</button></div>
              </div>
            </div>
          </footer>
        </div>\`;
      const prompt = document.getElementById('prompt');
      prompt?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendPrompt();
      });
      app.querySelector('.messages')?.scrollTo(0, app.querySelector('.messages').scrollHeight);
    }
    function renderEmpty(ws) {
      return '<section class="empty"><div class="empty-title">How can I help?</div><div>' + (ws ? 'Ask OpenCode to work in ' + esc(ws.name || 'this workspace') + '.' : 'Open a workspace to start.') + '</div></section>';
    }
    function renderMessages() {
      return messages.map(msg => '<div class="message ' + esc(msg.role) + '"><div class="bubble ' + (msg.kind === 'error' ? 'notice error' : '') + '">' + esc(msg.text) + '</div></div>').join('');
    }
    function sendPrompt() {
      const el = document.getElementById('prompt');
      const prompt = el?.value.trim();
      if (!prompt) return;
      messages.push({ role: 'user', text: prompt });
      messages.push({ role: 'assistant', text: 'Starting OpenCode and sending your request...', kind: 'sent' });
      el.value = '';
      save();
      render();
      post('sendPrompt', { prompt });
    }
    function insert(text) {
      const el = document.getElementById('prompt');
      el.value += text;
      el.focus();
    }
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('button');
      if (!button) return;
      if (button.dataset.post) post(button.dataset.post);
      if (button.dataset.send) sendPrompt();
      if (button.dataset.insert !== undefined) insert(button.dataset.insert);
      if (button.dataset.details) { detailsOpen = !detailsOpen; save(); render(); }
    });
    render();
  </script>
</body>
</html>`
  }
}
