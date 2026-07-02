import * as vscode from "vscode"
import { randomBytes } from "node:crypto"
import { OpenCodeServices } from "./services"

export class OpenCodePanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView
  private readonly changeSub: vscode.Disposable
  private readonly eventSub: vscode.Disposable
  private viewSub?: vscode.Disposable

  constructor(private ctx: vscode.ExtensionContext, private services: OpenCodeServices) {
    this.changeSub = this.services.onDidChange(() => this.postState())
    this.eventSub = this.services.onDidEvent(({ workspaceId, event }) => this.postEvent(workspaceId, event))
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = this.html(view.webview)
    this.viewSub?.dispose()
    this.viewSub = view.webview.onDidReceiveMessage((msg) => void this.handleMessage(msg))
  }

  dispose() {
    this.changeSub.dispose()
    this.eventSub.dispose()
    this.viewSub?.dispose()
  }

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
            await this.services.sendPrompt(msg.prompt.trim(), {
              agent: typeof msg.agent === "string" ? msg.agent : undefined,
              model: isModelPick(msg.model) ? msg.model : undefined,
            })
          }
          break
        case "loadMenu": {
          const rt = await this.services.ensureReady()
          if (msg.menu === "agent") await this.services.listAgents(rt)
          if (msg.menu === "skill") await this.services.listSkills(rt)
          if (msg.menu === "model") await this.services.listModels(rt)
          break
        }
        case "permission":
          if (isPermissionMessage(msg)) {
            await this.services.replyPermission(msg.workspaceId, msg.requestID, msg.reply)
          }
          break
        case "ready":
          this.postState()
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

  private postEvent(workspaceId: string, event: any) {
    void this.view?.webview.postMessage({ type: "event", workspaceId, event })
  }

  private html(webview: vscode.Webview) {
    const nonce = randomBytes(16).toString("base64")
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    html, body, #app { height: 100%; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    button, textarea { font: inherit; }
    button { border: 0; border-radius: 5px; color: var(--vscode-foreground); background: transparent; cursor: pointer; }
    button:hover { background: var(--vscode-toolbar-hoverBackground); }
    button.primary { min-width: 52px; padding: 4px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.subtle { padding: 3px 7px; color: var(--vscode-descriptionForeground); }
    textarea { display: block; width: 100%; min-width: 0; min-height: 62px; max-height: 170px; padding: 9px 10px 2px; border: 0; outline: 0; resize: vertical; color: var(--vscode-input-foreground); background: transparent; line-height: 1.45; }
    .shell { height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 10px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .workspace { min-width: 0; }
    .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar { display: flex; gap: 2px; flex: 0 0 auto; }
    .messages { min-height: 0; overflow-y: auto; padding: 10px; }
    .history { margin: 0 0 12px; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: var(--vscode-editor-background); }
    .history-title { margin-bottom: 6px; color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .history-list { display: grid; gap: 4px; max-height: 145px; overflow-y: auto; }
    .history button { width: 100%; padding: 6px 7px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty { height: 100%; display: grid; align-content: center; justify-items: center; gap: 7px; text-align: center; color: var(--vscode-descriptionForeground); padding: 20px; }
    .empty-title { color: var(--vscode-foreground); font-size: 15px; font-weight: 600; }
    .message { margin: 0 0 12px; }
    .message.user { display: flex; justify-content: flex-end; }
    .bubble { max-width: 92%; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); white-space: pre-wrap; overflow-wrap: anywhere; }
    .user .bubble { background: var(--vscode-input-background); background: color-mix(in srgb, var(--vscode-button-background) 14%, var(--vscode-editor-background)); }
    .assistant .bubble { border-top-left-radius: 3px; }
    .notice { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .notice.error { color: var(--vscode-errorForeground); }
    .detail-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .detail-row button { padding: 3px 7px; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); }
    .menu { margin-top: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); overflow: hidden; box-shadow: 0 6px 18px rgba(0,0,0,.25); }
    .menu-title { padding: 7px 8px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .menu-list { max-height: 210px; overflow-y: auto; }
    .menu button { width: 100%; display: block; padding: 7px 8px; border-radius: 0; text-align: left; }
    .menu button:hover { background: var(--vscode-list-hoverBackground); }
    .menu .meta { display: block; margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .selection { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
    .chip { padding: 3px 7px; border: 1px solid var(--vscode-panel-border); border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-badge-background); }
    .composer-wrap { min-width: 0; padding: 8px 10px 10px; border-top: 1px solid var(--vscode-panel-border); overflow: hidden; }
    .composer { min-width: 0; max-width: 100%; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 10px; background: var(--vscode-input-background); overflow: visible; }
    .composer:focus-within { border-color: var(--vscode-focusBorder); }
    .composer-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; padding: 6px; min-width: 0; }
    .pickers { display: flex; gap: 4px; flex-wrap: wrap; min-width: 0; }
    .pickers button { min-width: 0; }
    .send { display: flex; gap: 4px; min-width: max-content; }
    .hint { grid-column: 1 / -1; min-width: 0; color: var(--vscode-descriptionForeground); font-size: 11px; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const persisted = vscode.getState?.() || {};
    let workspaces = persisted.workspaces || [];
    let messages = [];
    let notice = persisted.notice || '';
    let noticeLevel = persisted.noticeLevel || 'sent';
    let draft = persisted.draft || '';
    let menuOpen = persisted.menuOpen || '';
    let selectedAgent = persisted.selectedAgent || '';
    let selectedModel = persisted.selectedModel || null;

    window.addEventListener('message', event => {
      if (event.data?.type === 'state') {
        workspaces = event.data.workspaces || [];
        surfaceWorkspaceError();
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
      if (event.data?.type === 'event') {
        handleOpenCodeEvent(event.data.workspaceId, event.data.event);
        save();
        render();
      }
    });

    function post(type, data = {}) { vscode.postMessage({ type, ...data }); }
    function save() { vscode.setState?.({ workspaces, notice, noticeLevel, draft, menuOpen, selectedAgent, selectedModel }); }
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
    function surfaceWorkspaceError() {
      const ws = workspaces[0];
      if (!ws?.error) return;
      const msg = lastAssistant();
      if (msg?.text === ws.error) return;
      if (msg?.kind === 'pending' || messages.some(item => item.role === 'user')) {
        appendNotice(ws.error, 'error');
      }
    }
    function render() {
      const app = document.getElementById('app');
      const currentPrompt = document.getElementById('prompt');
      if (currentPrompt) draft = currentPrompt.value;
      const ws = workspaces[0];
      app.innerHTML = \`
        <div class="shell">
          <header class="header">
            <div class="workspace">
              <div class="name">\${ws ? esc(ws.name || ws.dir || 'Workspace') : 'OpenCode'}</div>
              <div class="status">\${esc(statusText(ws))}\${ws?.dir ? ' · ' + esc(ws.dir) : ''}</div>
            </div>
            <div class="toolbar">
              <button class="subtle" title="New session" aria-label="New session" data-post="newSession">+</button>
              <button class="subtle" title="Stop" aria-label="Stop active run" data-post="abort">Stop</button>
            </div>
          </header>
          <main class="messages">
            \${renderSessionHistory(ws)}
            \${messages.length ? renderMessages() : renderEmpty(ws)}
            \${renderPermissions(ws)}
          </main>
          <footer class="composer-wrap">
            <div class="composer">
              <textarea id="prompt" aria-label="Prompt" placeholder="Ask OpenCode to build, explain, debug, or refactor...">\${esc(draft)}</textarea>
              \${renderMenu(ws)}
              \${renderSelection()}
              <div class="composer-actions">
                <div class="pickers">
                  <button class="subtle" data-menu="model" aria-expanded="\${menuOpen === 'model' ? 'true' : 'false'}">Model</button>
                  <button class="subtle" data-menu="agent" aria-expanded="\${menuOpen === 'agent' ? 'true' : 'false'}">Agent</button>
                  <button class="subtle" data-menu="skill" aria-expanded="\${menuOpen === 'skill' ? 'true' : 'false'}">Skill</button>
                </div>
                <div class="send"><button class="primary" data-send="true">Send</button></div>
                <div class="hint">Ctrl+Enter sends. Enter adds a new line.</div>
              </div>
            </div>
          </footer>
        </div>\`;
      const prompt = document.getElementById('prompt');
      prompt?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); sendPrompt(); }
      });
      app.querySelector('.messages')?.scrollTo(0, app.querySelector('.messages').scrollHeight);
    }
    function renderEmpty(ws) {
      return '<section class="empty"><div class="empty-title">How can I help?</div><div>' + (ws ? 'Ask OpenCode to work in ' + esc(ws.name || 'this workspace') + '.' : 'Open a workspace to start.') + '</div></section>';
    }
    function renderSessionHistory(ws) {
      if (!ws || messages.some(msg => msg.role === 'user')) return '';
      const sessions = (ws.sessions || []).slice().sort((a, b) => ((b.time?.updated || b.time?.created || 0) - (a.time?.updated || a.time?.created || 0))).slice(0, 8);
      if (!sessions.length) return '';
      return '<section class="history"><div class="history-title">Recent sessions</div><div class="history-list">' + sessions.map(session => '<button data-session-id="' + esc(session.id) + '" data-workspace-id="' + esc(ws.workspaceId) + '">' + esc(session.title || session.id) + '<span class="meta">' + esc(session.id) + '</span></button>').join('') + '</div></section>';
    }
    function renderMessages() {
      return messages.map(msg => '<div class="message ' + esc(msg.role) + '"><div class="bubble ' + (msg.kind === 'error' ? 'notice error' : '') + '">' + esc(msg.text) + '</div></div>').join('');
    }
    function renderPermissions(ws) {
      const permissions = ws?.permissions || [];
      if (!permissions.length) return '';
      return '<div class="notice">Pending permissions</div>' + permissions.map(permission => '<div class="detail-row"><span>' + esc(permission.permission || 'Permission') + '</span><button data-permission="once" data-workspace-id="' + esc(ws.workspaceId) + '" data-request-id="' + esc(permission.id) + '">Approve once</button><button data-permission="always" data-workspace-id="' + esc(ws.workspaceId) + '" data-request-id="' + esc(permission.id) + '">Always</button><button data-permission="reject" data-workspace-id="' + esc(ws.workspaceId) + '" data-request-id="' + esc(permission.id) + '">Reject</button></div>').join('');
    }
    function renderSelection() {
      const items = [];
      if (selectedModel) items.push('<span class="chip">Model: ' + esc(selectedModel.providerID + '/' + selectedModel.modelID) + '</span>');
      if (selectedAgent) items.push('<span class="chip">Agent: @' + esc(selectedAgent) + '</span>');
      return items.length ? '<div class="selection">' + items.join('') + '<button class="subtle" data-clear-selection="true">Clear</button></div>' : '';
    }
    function renderMenu(ws) {
      if (!menuOpen) return '';
      if (!ws) return '<div class="menu"><div class="menu-title">Open a workspace first</div></div>';
      if (menuOpen === 'model') return renderModelMenu(ws.models || []);
      if (menuOpen === 'agent') return renderAgentMenu(ws.agents || []);
      if (menuOpen === 'skill') return renderSkillMenu(ws.skills || []);
      return '';
    }
    function renderModelMenu(models) {
      const visible = models.slice(0, 80);
      return '<div class="menu"><div class="menu-title">Choose model</div><div class="menu-list">' + (visible.length ? visible.map(model => '<button data-select-model="true" data-provider-id="' + esc(model.providerID) + '" data-model-id="' + esc(model.modelID) + '" data-label="' + esc(model.label || '') + '">' + esc(model.label || model.modelID) + '<span class="meta">' + esc(model.providerID + '/' + model.modelID) + '</span></button>').join('') : '<button data-menu-refresh="model">No models yet. Retry</button>') + '</div></div>';
    }
    function renderAgentMenu(agents) {
      const visible = agents.filter(agent => !agent.hidden).slice(0, 80);
      return '<div class="menu"><div class="menu-title">Choose agent</div><div class="menu-list">' + (visible.length ? visible.map(agent => '<button data-select-agent="' + esc(agent.name) + '">@' + esc(agent.name) + '<span class="meta">' + esc(agent.mode || 'agent') + '</span></button>').join('') : '<button data-menu-refresh="agent">No agents yet. Retry</button>') + '</div></div>';
    }
    function renderSkillMenu(skills) {
      const visible = skills.slice(0, 80);
      return '<div class="menu"><div class="menu-title">Insert skill</div><div class="menu-list">' + (visible.length ? visible.map(skill => '<button data-insert-skill="' + esc(skill.triggerText || '/' + skill.name + ' ') + '">' + esc(skill.name) + '<span class="meta">' + esc(skill.description || skill.source || 'skill') + '</span></button>').join('') : '<button data-menu-refresh="skill">No skills yet. Retry</button>') + '</div></div>';
    }
    function sendPrompt() {
      const el = document.getElementById('prompt');
      const prompt = el?.value.trim();
      if (!prompt) return;
      messages.push({ role: 'user', text: prompt });
      messages.push({ role: 'assistant', text: '', kind: 'pending' });
      draft = '';
      el.value = '';
      save();
      render();
      post('sendPrompt', { prompt, agent: selectedAgent || undefined, model: selectedModel || undefined });
    }
    function handleOpenCodeEvent(workspaceId, event) {
      const props = event?.properties || {};
      const part = props.part || {};
      const sessionID = props.sessionID || props.info?.sessionID || part.sessionID;
      const ws = workspaces[0];
      if (ws?.workspaceId !== workspaceId) return;
      if (ws?.activeSessionId && sessionID && sessionID !== ws.activeSessionId) return;

      if (event.type === 'message.part.delta' && typeof props.delta === 'string') appendAssistant(props.delta);
      if (event.type === 'message.part.updated') {
        if (typeof props.delta === 'string') appendAssistant(props.delta);
        else if (part.type === 'text' && part.text) setAssistant(part.text);
        if (part.type === 'tool') appendNotice((part.state?.title || part.tool || 'tool') + ': ' + (part.state?.status || 'running'));
      }
      if (event.type === 'message.updated' && props.info?.role === 'assistant' && props.info?.error) appendNotice(String(props.info.error), 'error');
      if (event.type === 'session.error') appendNotice(String(props.error?.message || props.error || 'OpenCode session failed'), 'error');
      if (event.type === 'session.status' && props.status?.type && props.status.type !== 'busy') finishPending();
      if (event.type === 'session.idle') finishPending();
    }
    function appendAssistant(text) {
      const msg = lastAssistant();
      if (msg) { msg.text += text; msg.kind = undefined; }
      else messages.push({ role: 'assistant', text });
    }
    function setAssistant(text) {
      const msg = lastAssistant();
      if (msg && (!msg.text || text.startsWith(msg.text))) { msg.text = text; msg.kind = undefined; }
      else if (!msg) messages.push({ role: 'assistant', text });
    }
    function appendNotice(text, kind = 'sent') {
      const msg = lastAssistant();
      if (msg && msg.kind === 'pending' && !msg.text) { msg.text = text; msg.kind = kind; return; }
      messages.push({ role: 'assistant', text, kind });
    }
    function finishPending() {
      const msg = lastAssistant();
      if (msg?.kind === 'pending' && !msg.text) { msg.text = 'No response text was returned.'; msg.kind = 'sent'; }
    }
    function lastAssistant() {
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return messages[i];
      return undefined;
    }
    function insert(text) {
      const el = document.getElementById('prompt');
      if (!el) return;
      el.value += text;
      draft = el.value;
      save();
      el.focus();
    }
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('button');
      if (!button) return;
      if (button.dataset.post) post(button.dataset.post);
      if (button.dataset.send) sendPrompt();
      if (button.dataset.insert !== undefined) insert(button.dataset.insert);
      if (button.dataset.insertSkill !== undefined) { insert(button.dataset.insertSkill); menuOpen = ''; save(); render(); }
      if (button.dataset.menu) { menuOpen = menuOpen === button.dataset.menu ? '' : button.dataset.menu; save(); render(); post('loadMenu', { menu: button.dataset.menu }); }
      if (button.dataset.menuRefresh) post('loadMenu', { menu: button.dataset.menuRefresh });
      if (button.dataset.selectAgent) { selectedAgent = button.dataset.selectAgent; menuOpen = ''; save(); render(); }
      if (button.dataset.selectModel) { selectedModel = { providerID: button.dataset.providerId, modelID: button.dataset.modelId, label: button.dataset.label || button.dataset.modelId }; menuOpen = ''; save(); render(); }
      if (button.dataset.clearSelection) { selectedAgent = ''; selectedModel = null; save(); render(); }
      if (button.dataset.sessionId) { messages = []; post('selectSession', { workspaceId: button.dataset.workspaceId, sessionID: button.dataset.sessionId }); }
      if (button.dataset.permission) post('permission', { workspaceId: button.dataset.workspaceId, requestID: button.dataset.requestId, reply: button.dataset.permission });
    });
    document.addEventListener('input', event => {
      if (event.target?.id === 'prompt') { draft = event.target.value; save(); }
    });
    render();
    post('ready');
  </script>
</body>
</html>`
  }
}

function isPermissionMessage(msg: any): msg is { workspaceId: string; requestID: string; reply: "once" | "always" | "reject" } {
  return typeof msg?.workspaceId === "string"
    && typeof msg?.requestID === "string"
    && (msg.reply === "once" || msg.reply === "always" || msg.reply === "reject")
}

function isModelPick(value: any): value is { providerID: string; modelID: string; label: string } {
  return typeof value?.providerID === "string"
    && typeof value?.modelID === "string"
    && typeof value?.label === "string"
}
