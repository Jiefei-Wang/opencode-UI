# OpenCode VS Code Extension Architecture Plan

## Goal

Build a maintainable VS Code extension that starts an OpenCode server per workspace, exposes OpenCode through the VS Code Chat/Copilot pane, and provides a richer custom panel for OpenCode-specific workflows.

The architecture should separate VS Code UI concerns from OpenCode runtime concerns so the chat participant, webview panel, and commands all share the same backend state.

## High-Level Architecture

```text
VS Code Extension Host
  package.json contributions
  extension.ts
  commands/
  chat/
  views/
  runtime/
  opencode/
  state/
  webview/

OpenCode Runtime Per Workspace
  opencode serve --hostname 127.0.0.1 --port <free-port>
  @opencode-ai/sdk/v2/client
  SSE event subscription
```

## VS Code Contributions

The extension manifest should contribute:

- `chatParticipants` for `@opencode`.
- Commands for all important actions.
- Configuration settings.
- Optional Activity Bar or Side Bar view container for the OpenCode panel.
- Webview views for session/control UI.
- Status bar item from runtime code.

Recommended `extensionKind`:

```json
"extensionKind": ["workspace"]
```

This is important for Remote SSH. The extension should run where the workspace lives so `opencode serve` starts on the correct machine and sees the correct filesystem.

## Project Structure

```text
src/
  extension.ts
  commands/
    index.ts
    commandRegistry.ts
  chat/
    participant.ts
    slashCommands.ts
    render.ts
    followups.ts
  runtime/
    server.ts
    workspaceManager.ts
    processTree.ts
    environment.ts
  opencode/
    client.ts
    types.ts
    eventHub.ts
    sessionManager.ts
    agents.ts
    skills.ts
    permissions.ts
  state/
    activeSessionStore.ts
    workspaceState.ts
  views/
    statusBar.ts
    panelProvider.ts
    webviewHtml.ts
  webview/
    index.tsx
    App.tsx
    api.ts
    components/
      SessionList.tsx
      AgentPicker.tsx
      SkillPicker.tsx
      SlashCommandPicker.tsx
      TodoList.tsx
      DiffList.tsx
      ServerStatus.tsx
      Composer.tsx
```

## Runtime Lifecycle

Use the proven pattern from `zgy.opencode-vscode-ui`:

1. Resolve workspace folder.
2. Allocate a free local port by binding to `127.0.0.1:0`.
3. Spawn OpenCode:

```text
opencode serve --port <port> --hostname 127.0.0.1
```

4. Set `cwd` to the workspace folder.
5. Set environment values:

```text
OPENCODE_CALLER=vscode
HTTP_PROXY / HTTPS_PROXY if configured
```

6. Wait for health check:

```text
GET http://127.0.0.1:<port>/global/health
```

7. Create SDK client with `@opencode-ai/sdk/v2/client`.
8. Subscribe to server events.
9. Mark runtime as ready.

Runtime states:

- `stopped`
- `starting`
- `ready`
- `busy`
- `error`
- `stopping`

## Workspace Manager

`WorkspaceManager` owns all per-workspace runtimes.

Responsibilities:

- Maintain `Map<workspaceId, WorkspaceRuntime>`.
- Start runtime on demand or on workspace open depending on settings.
- Stop runtime when workspace folder is removed.
- Restart runtime on command.
- Serialize start/stop operations per workspace.
- Expose change events to chat, status bar, and webview.
- Log stdout/stderr to an output channel.

Runtime shape:

```ts
type WorkspaceRuntime = {
  workspaceId: string
  folderUri: vscode.Uri
  name: string
  dir: string
  port?: number
  url?: string
  state: RuntimeState
  process?: child_process.ChildProcess
  client?: OpenCodeClient
  error?: string
}
```

## Server Process Management

`runtime/server.ts` should provide:

- `freePort()`.
- `spawnServer(dir, port, env)`.
- `waitForHealth(url, timeout, retries)`.
- `detectStartupFailure(process)`.
- `stopServer(process)`.

Shutdown behavior:

- On Unix, spawn detached and kill the process group with `SIGINT`, then `SIGTERM`, then `SIGKILL` if needed.
- On Windows, use `taskkill /pid <pid> /t /f`.
- Always clean up on extension deactivate.

## OpenCode Client Layer

`opencode/client.ts` wraps the SDK.

It should expose only the methods the extension uses:

- `listSessions`.
- `createSession`.
- `deleteSession`.
- `getMessages`.
- `promptAsync`.
- `runCommand`.
- `abortSession`.
- `getTodos`.
- `getDiff`.
- `listAgents`.
- `listCommands`.
- `listProviders`.
- `listPermissions`.
- `replyPermission`.
- `listQuestions`.
- `replyQuestion`.
- `subscribeEvents`.

Keep OpenCode API typing in `opencode/types.ts`. Do not leak raw SDK response shapes throughout the UI.

## Event Hub

`EventHub` owns OpenCode SSE subscriptions.

Responsibilities:

- Subscribe once per ready workspace runtime.
- Reconnect after server restart.
- Route events by workspace and session.
- Normalize OpenCode events into extension events.
- Update session/todo/diff/permission/question caches.
- Notify active chat streams.
- Notify webview panels.

Important OpenCode events to handle:

- `session.created`
- `session.updated`
- `session.deleted`
- `session.status`
- `message.updated`
- `message.part.updated`
- `message.part.delta`
- `message.part.removed`
- `todo.updated`
- `session.diff`
- `permission.asked`
- `permission.replied`
- `question.asked`
- `question.replied`

## Session Manager

`SessionManager` maps VS Code interactions to OpenCode sessions.

Responsibilities:

- Track active session per workspace.
- Create a new session when needed.
- Resume selected sessions.
- Persist active session IDs in `context.workspaceState`.
- Maintain session cache for UI.
- Expose high-level operations for chat and webview.

Session selection rules:

- If user uses `/new`, create a new session.
- If user uses `/resume`, show picker.
- If there is an active session for the workspace, continue it.
- If there is no active session, create one automatically after confirming workspace selection if multi-root.

## Chat Participant

`chat/participant.ts` registers `@opencode` using `vscode.chat.createChatParticipant`.

Responsibilities:

- Parse `request.command` and `request.prompt`.
- Resolve target workspace.
- Ensure OpenCode runtime is ready.
- Resolve active session.
- Send prompt/command to OpenCode.
- Stream responses back into VS Code Chat.
- Render permissions/questions as buttons.
- Return metadata for follow-up suggestions.

The handler should be thin. It should call services instead of owning runtime logic.

## Slash Command Handling

`chat/slashCommands.ts` should define slash commands in one place.

Each command should include:

```ts
type SlashCommandDefinition = {
  name: string
  description: string
  run: (context: SlashCommandContext) => Promise<void>
}
```

Commands should be usable from:

- VS Code Chat slash command contributions.
- OpenCode panel slash command picker.
- Command Palette commands.

This avoids duplicating behavior.

## Chat Rendering

`chat/render.ts` converts OpenCode data into Chat UI output.

Rendering rules:

- Stream assistant text deltas as markdown.
- Render tool start/completion as progress messages.
- Render file references using `stream.reference()`.
- Render permission prompts using `stream.button()`.
- Render long diffs and tool outputs as buttons that open the rich panel.
- Respect `opencode.showThinking` before showing reasoning parts.

Avoid flooding Chat with huge tool output. Chat should be readable; the custom panel can show detail.

## Agents Service

`opencode/agents.ts` normalizes available agents.

Sources:

- OpenCode `app.agents` API.
- OpenCode config default agent.
- Session message metadata when relevant.

Returned model:

```ts
type AgentItem = {
  name: string
  mode: "primary" | "subagent" | "all"
  hidden: boolean
  model?: string
  description?: string
}
```

Operations:

- `listAgents(workspace)`.
- `setSessionAgent(session, agent)`.
- `insertAgentMention(agent)` through UI message.

## Skills Service

`opencode/skills.ts` normalizes installed skills.

OpenCode skill exposure may differ by version, so this service should be isolated.

Possible sources:

- OpenCode command list where `source === "skill"`.
- Config APIs if skills are exposed separately.
- MCP resource/command metadata if skills are provided externally.

Returned model:

```ts
type SkillItem = {
  id: string
  name: string
  description?: string
  source: "workspace" | "user" | "extension" | "mcp" | "unknown"
  triggerText: string
  hints: string[]
}
```

Operations:

- `listSkills(workspace)`.
- `insertSkillTrigger(skill)`.
- `runSkill(skill, prompt)`.

Default UI behavior should insert `triggerText` into the composer instead of immediately running.

## Webview Panel

The webview should be a client of extension state, not a separate OpenCode client.

Message flow:

```text
React Webview -> postMessage(action) -> Extension Host -> Services -> OpenCode SDK
OpenCode Events -> EventHub -> Extension Host -> postMessage(state/update) -> React Webview
```

Webview actions:

- `newSession`
- `resumeSession`
- `deleteSession`
- `sendPrompt`
- `abort`
- `selectAgent`
- `insertAgent`
- `selectSkill`
- `insertSkill`
- `runSlashCommand`
- `openDiff`
- `openFile`
- `replyPermission`
- `replyQuestion`
- `restartServer`
- `checkEnvironment`

Use strict message types for both directions.

## State Management

Extension host state:

- Runtime state in memory.
- Session cache in memory.
- Active session IDs in `workspaceState`.
- UI preferences in VS Code settings.

Do not persist server ports or process IDs. They are per-window runtime details.

Webview state:

- Treat extension host as source of truth.
- Keep local UI state only for filters, selected tab, and draft input.

## Configuration

Settings:

```json
{
  "opencode.executablePath": "",
  "opencode.autoStart": "onFirstUse",
  "opencode.httpProxy": "",
  "opencode.defaultAgent": "",
  "opencode.defaultModel": "",
  "opencode.showThinking": true,
  "opencode.richPanel.enabled": true
}
```

Setting scopes:

- `executablePath`: `machine-overridable`.
- `httpProxy`: `machine-overridable`.
- `autoStart`: `window`.
- `defaultAgent`: `resource` or `window`.
- `defaultModel`: `resource` or `window`.
- `showThinking`: `window`.
- `richPanel.enabled`: `window`.

When executable/proxy changes, prompt for server restart or window reload.

## Environment Check

`runtime/environment.ts` should verify:

- Workspace folder exists.
- `opencode` executable resolves.
- `opencode --version` works if cheap/supported.
- Server can bind a local port.
- Health endpoint responds after spawn.
- Running host label: local, SSH, WSL, container, codespaces.

Remote guidance:

- If `vscode.env.remoteName` is set, messages must say OpenCode is required on the remote host, not the local machine.

## Security

Security rules:

- Bind OpenCode only to `127.0.0.1`.
- Never expose the server on `0.0.0.0`.
- Do not log secrets from prompts or environment.
- Keep command URI trust lists narrow.
- Permission buttons should call specific extension commands with validated request IDs.
- Webview CSP should disallow arbitrary scripts and remote code.

## Error Handling

Common errors should produce actionable UI:

- Missing `opencode`: show setup card and settings button.
- Server startup timeout: show output and restart button.
- Port allocation failure: retry and show error if repeated.
- SDK request failure: show concise chat error plus output log link.
- SSE disconnect: mark runtime degraded and reconnect or request restart.
- Permission/question timeout: keep pending state visible.

## Testing Plan

Unit tests:

- Slash command parser.
- Event normalization.
- Chat rendering decisions.
- Agent/skill normalization.
- Workspace/session state selection.

Integration tests with mocked OpenCode server:

- Server health startup.
- Session creation and prompt flow.
- SSE text delta streaming.
- Permission request/reply.
- Todo and diff updates.

Manual VS Code tests:

- Local workspace.
- Multi-root workspace.
- Remote SSH workspace.
- Missing executable.
- Server crash/restart.
- Chat participant in right-side Chat view.
- Custom panel moved to secondary sidebar.

## Recommended V1 Architecture Scope

V1 should implement:

- Workspace runtime manager.
- OpenCode SDK wrapper.
- Event hub.
- Session manager.
- Chat participant.
- Slash command registry.
- Minimal webview panel with buttons, agents, skills, sessions, todos, diffs, and status.
- Status bar item.
- Environment checks.

Defer:

- Full transcript rendering parity.
- Editing agents/skills.
- Advanced MCP management.
- Cloud delegation workflows.
- Telemetry.
