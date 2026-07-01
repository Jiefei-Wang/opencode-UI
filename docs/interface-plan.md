# OpenCode VS Code Extension Interface Plan

## Goal

Build a VS Code interface that feels like a first-class coding-agent experience: fast to open, easy to discover, friendly for non-terminal users, and close to the Copilot/Codex right-side workflow.

The extension should not require users to memorize command IDs or slash commands. Everything important should be reachable from visible buttons, menus, pickers, and chat suggestions.

## Primary Surface

Use VS Code Chat as the primary surface via an `@opencode` chat participant.

This gives users the closest public API equivalent to the Copilot/Codex right pane:

- Users can open the built-in Chat view and place it on the right side.
- `@opencode` appears in the Chat participant list.
- OpenCode responses can stream markdown, progress, file references, command buttons, and follow-up suggestions.
- The UI remains native to VS Code instead of fighting the workbench layout.

## Secondary Surface

Add a custom OpenCode side view/panel for richer session management.

This view should be optional but prominent. It gives OpenCode-specific controls that the Chat Participant API does not expose well:

- Session list.
- Active session status.
- New/resume/delete session controls.
- Installed agents.
- Installed skills.
- Available slash commands.
- Todos.
- Modified files and diffs.
- Pending permissions/questions.
- Server status and restart/check controls.

This panel can be contributed as a normal view. VS Code does not let extensions force a contributed view into the right sidebar, but users can move it there. The extension should include a command and welcome text explaining “Move OpenCode to Secondary Side Bar” if the user wants a Codex-like right-side layout.

## Navigation Model

Use three simple entry points:

- `OpenCode Chat`: opens VS Code Chat focused on `@opencode`.
- `OpenCode`: opens the rich OpenCode panel.
- `OpenCode Status`: compact status bar item showing server/session state.

Avoid creating too many Activity Bar icons or scattered commands.

## Chat Header Actions

The user should be able to perform common OpenCode actions without `Ctrl+P`.

In the OpenCode panel and chat-adjacent UI, expose buttons for:

- New Session.
- Resume Session.
- Pick Agent.
- Pick Skill.
- Pick Model.
- Show Slash Commands.
- Show Todo.
- Show Diff.
- Abort.
- Restart Server.

Where possible, chat responses should also include action buttons:

- Continue.
- Abort.
- Open Diff.
- Open Modified File.
- Approve Once.
- Approve Always.
- Reject.
- Answer Question.

## Slash Command Discovery

Slash commands should be available from the input box and from visible UI.

Contribute slash commands under `@opencode`:

- `/new`: start a new OpenCode session.
- `/resume`: resume an existing session.
- `/sessions`: list recent sessions.
- `/agent`: choose or switch agent.
- `/skill`: choose or insert a skill.
- `/model`: choose provider/model.
- `/todo`: show current todos.
- `/diff`: show current diff.
- `/abort`: stop active run.
- `/permissions`: review pending permission requests.
- `/status`: show server and session status.

Also provide a `Slash Commands` button in the OpenCode panel. Selecting a command should insert the command text into the active chat input when possible, or start a new `@opencode /command` chat request when VS Code APIs do not allow direct insertion.

## Command Palette Replacement

Every important Command Palette command should have a visible equivalent.

Command Palette commands still exist for keyboard users, but buttons should cover the same actions:

| Command Palette Command | Visible UI Equivalent |
| --- | --- |
| `OpenCode: New Session` | `New Session` button |
| `OpenCode: Resume Session` | `Resume` button and session list |
| `OpenCode: Open Chat` | `Chat` button |
| `OpenCode: Open Panel` | Activity Bar or status item click |
| `OpenCode: Pick Agent` | Agent picker button |
| `OpenCode: Pick Skill` | Skill picker button |
| `OpenCode: Pick Model` | Model picker button |
| `OpenCode: Show Todo` | Todo tab/button |
| `OpenCode: Show Diff` | Modified Files tab/button |
| `OpenCode: Abort` | Abort button visible during running sessions |
| `OpenCode: Check Environment` | Server status card action |
| `OpenCode: Restart Server` | Server status card action |
| `OpenCode: Open Output` | Server status card action |

## Agents UI

Users should be able to see installed OpenCode agents and use them without remembering names.

Agent list behavior:

- Load agents from OpenCode server APIs.
- Show built-in and user agents.
- Show name, mode, model if configured, and a short description if available.
- Hide internal/hidden agents by default, with a toggle to show them.
- Mark the currently active/default agent.

Agent actions:

- `Use for this session`: sets active agent for future prompts in the current session.
- `Insert mention`: inserts `@agent-name` or the appropriate OpenCode prompt part into the input.
- `Start new session with agent`: creates a new session and preselects that agent.
- `View source/config`: opens the agent definition if the server exposes a local path.

If direct chat input insertion is limited by VS Code APIs, selecting an agent should open/focus `@opencode` chat with a prepared prompt or use the custom panel input where insertion is fully controlled.

## Skills UI

Users should be able to inspect and trigger installed OpenCode skills.

Skill list behavior:

- Load skills from OpenCode command/config APIs if available.
- If skills are represented as commands or prompt metadata, normalize them into a `Skills` list.
- Show skill name, description, source, and trigger hints.
- Group skills by source:
  - Workspace skills.
  - User skills.
  - Extension/bundled skills.
  - MCP-provided skills, if applicable.

Skill actions:

- `Insert`: inserts the skill trigger into the input textbox so the user can see what will be sent.
- `Run`: sends an `@opencode` request using that skill.
- `Details`: shows skill description, trigger text, and source.

The default action should be `Insert`, not `Run`, because it is safer and teaches the user what the skill means.

## Input Experience

The custom OpenCode panel should include a composer even if VS Code Chat is the primary surface.

Composer controls:

- Text input with multiline support.
- Agent dropdown.
- Skill button.
- Slash command button.
- Model dropdown.
- File/context attachment button.
- Send button.
- Stop button while running.

Composer autocomplete:

- `/` opens command menu.
- `@` opens agents menu.
- `#` or file button opens workspace file picker.
- Skill button opens searchable skills picker.

## Session UI

Session list should be understandable at a glance:

- Title.
- Workspace folder.
- Last updated time.
- Status: idle, busy, retry, error.
- Active agent/model when known.
- Modified files count.
- Todo count.

Session actions:

- Open.
- Rename if supported by OpenCode.
- Continue.
- Delete.
- Show diff.
- Copy session ID.

## Todo UI

Todos should be visible without needing a command.

Show:

- Pending, in-progress, completed groups.
- Priority badges.
- Link back to the message/tool that created the todo if possible.

Actions:

- Refresh.
- Insert todo context into prompt.
- Ask OpenCode to continue from next pending todo.

## Diff UI

Modified files should be visible and actionable.

Show:

- File list with additions/deletions.
- Status: added, modified, deleted.
- Unified/split diff preference.

Actions:

- Open file.
- Open diff.
- Revert message/session if OpenCode supports it.
- Insert file reference into prompt.

## Permissions And Questions

OpenCode may ask for tool permissions or user decisions.

These should never be hidden in logs.

Render pending items in:

- Chat response buttons.
- OpenCode panel notification area.
- Status bar warning state.

Permission actions:

- Approve Once.
- Approve Always.
- Reject.

Question actions:

- Select options.
- Type custom answer if allowed.
- Submit.
- Reject/cancel.

## Status Bar

Add a compact status item:

- `OpenCode: Ready`.
- `OpenCode: Starting`.
- `OpenCode: Busy`.
- `OpenCode: Needs Permission`.
- `OpenCode: Error`.

Clicking the status item opens a quick menu:

- Open Chat.
- Open Panel.
- New Session.
- Show Pending Permission.
- Restart Server.
- Check Environment.
- Open Output.

## First-Run Experience

If `opencode` is missing:

- Show a friendly setup card in the OpenCode panel.
- Offer `Check Environment` and `Open Settings` buttons.
- Explain whether VS Code is local or remote.
- For Remote SSH, tell the user OpenCode must be installed on the remote host.

If no workspace is open:

- Explain that OpenCode needs a workspace folder.
- Offer `Open Folder`.

If the server starts successfully:

- Show `New Session` and `Ask OpenCode` primary actions.

## Recommended V1 Interface Scope

V1 should include:

- `@opencode` chat participant.
- Visible OpenCode panel with session list, agents, skills, slash commands, status, todos, and diffs.
- Buttons for all major actions.
- Agent and skill pickers that insert visible trigger text before running.
- Status bar item.
- Environment check and server restart UI.

Defer:

- Advanced visual transcript parity with every OpenCode terminal/UI feature.
- Full custom diff editor replacement.
- Full agent/skill editing UI.
- Cloud task workflows.
