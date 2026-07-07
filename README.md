# OpenCode VS Code Extension

OpenCode integration for VS Code with:

- `@opencode` Chat participant for the VS Code Chat/Copilot pane.
- OpenCode activity panel with buttons for sessions, commands, agents, skills, todos, diffs, permissions, and server controls.
- One `opencode serve` runtime per workspace folder.
- Direct HTTP/SSE communication with the OpenCode server. No OpenCode SDK is used.

## Run

```bash
npm install
npm run compile1
```

Then press `F5` in VS Code and run `OpenCode: Open Panel` or use `@opencode` in Chat.

If the workspace is on a synced drive and `npm install` fails, install from a normal local folder or move dependencies outside the synced directory.



## install

```bash
npm install
npm run compile
npx @vscode/vsce package
```