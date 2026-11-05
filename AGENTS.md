# AGENTS.md

Instructions and architectural overview for AI coding agents working on **Claude Deck**.

## Project Overview

Claude Deck consists of two halves that communicate asynchronously via JSON files in `~/.claude/deck/` and Claude Code's native JSONL transcripts in `~/.claude/projects/`:

1. **Claude Code Plugin (`plugin/`)** — Named `deck`. Runs inside each Claude Code session:
   - [`plugin/hooks/register.tsx`](plugin/hooks/register.tsx) & [`plugin/hooks/group.ts`](plugin/hooks/group.ts): Session lifecycle hooks (`session.start`, `prompt.submit`, `tool.call`, `turn.complete`, `session.end`), silent background session naming & folder classification via `$.model.complete({ model: 'haiku' })` (with `$.model.fork` fallback), zero-cost regex ticket detection from prompts and CLI commands (`acli`, `jira`, `gh`, `git checkout`), direct `custom-title` JSONL writes, and MCP tools (`name_session`, `set_ticket_titles`).
   - [`plugin/skills/`](plugin/skills/): Optional companion skills (`start-task`, `finish-task`, `cleanup-worktrees`).
   - [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) & [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json): Claude Code plugin manifests.

2. **VS Code Extension (`vscode/`)** — Named `kaiketsu-labs.claude-deck`. Renders the webview sidebar and status bar:
   - [`vscode/extension.js`](vscode/extension.js): VS Code activation, `WebviewViewProvider`, status bar item, file watchers on `~/.claude/deck/`, interactive terminal discovery (`ps -o ppid=` on macOS, `/proc/<pid>/stat` on Linux), automatic VS Code terminal tab renaming (`workbench.action.terminal.renameWithArg`), folder & session management commands (`newFolder`, `renameFolder`, `moveToFolder`, `rename`), and issue/PR polling (3-stage Jira cascade: REST API -> `acli` -> `jira-cli`; GitHub Issues & PRs via `gh`; custom `trackerCommand`).
   - [`vscode/inbox.js`](vscode/inbox.js): Self-contained Webview UI rendering top-level project/ticket folder cards, standalone ungrouped session cards, live status orbs, prompt cache progress bars, and drag-and-drop ordering.
   - [`vscode/group.js`](vscode/group.js): Pure grouping, folder & ticket normalization (`normalizeFolder`, `normalizeTicket`, `folderOf`, `ticketOf`, `folderTicket`), JSONL `custom-title` helpers (`encodeProjectPath`, `customTitleLine`), sorting, and state normalization logic.
   - [`vscode/package.py`](vscode/package.py): Zero-dependency Python script that packages the extension into a `.vsix` archive.

## Key Design Constraints

- **Zero npm dependencies in `vscode/`**: Keep the VS Code extension in plain CommonJS JavaScript (`extension.js`, `inbox.js`, `group.js`) using only built-in Node.js modules and the `vscode` API. Do not add a build step or `node_modules` to `vscode/`.
- **Keep `group.ts` and `group.js` aligned**: Folder and ticket parsing (`normalizeFolder`, `normalizeTicket`, `folderOf`, `ticketOf`, `extractTicket`, `encodeProjectPath`, `customTitleLine`) and session state logic live in both [`plugin/hooks/group.ts`](plugin/hooks/group.ts) and [`vscode/group.js`](vscode/group.js). When updating folder/ticket recognition rules or session schema fields, update both and their respective test suites.
- **Silent, non-intrusive session naming**:
  - Never mutate `e.text` in `prompt.submit` (doing so alters the user's visible prompt in the terminal).
  - Automatic naming runs silently in the background via `$.clock.after(10, ...)` and `$.model.complete({ model: 'haiku' })`, triggered once when a session is unnamed or once again when a ticket is newly bound (`ticketNewlyBound`).
  - Both plugin and sidebar renames write `name`, `folder`, and `ticket` directly to `~/.claude/deck/sessions/<id>.json` and append a `{"type":"custom-title","customTitle":...,"sessionId":...}` line to `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`.
- **Silent unconfigured trackers**: In `"auto"` mode (`claudeDeck.tracker` and `claudeDeck.pullRequests`), missing `JIRA_URL`/`JIRA_TOKEN` or unauthenticated `gh` / `acli` / `jira` CLIs must fail silently without showing error banners in the sidebar.
- **No scope creep**: Keep the plugin focused on session tracking, naming, and folder/ticket grouping.

## Testing & Verification

Run unit tests before committing any changes:

```bash
# VS Code extension unit tests (Node built-in test runner)
cd vscode && node --test

# Package VSIX to verify manifest and assets
cd vscode && python3 package.py
```

If Bun is installed, also run the plugin hook tests:

```bash
bun test plugin/hooks/group.test.ts
```

## Releasing & Shipping

- **Automated releases via Release Please**: Pushing Conventional Commits (`feat:`, `fix:`, etc.) to `main` causes [`.github/workflows/release.yml`](.github/workflows/release.yml) to open/update a Release PR that bumps [`vscode/package.json`](vscode/package.json), [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json), [`README.md`](README.md), and `CHANGELOG.md` via [`release-please-config.json`](release-please-config.json). Merging that PR creates the GitHub Release, builds and attaches `claude-deck-<version>.vsix`, and publishes to VS Code Marketplace / Open VSX if tokens are configured.
- **Plugin distribution**: Distributed directly from this GitHub repository via `.claude-plugin/marketplace.json` (`/plugin marketplace add kaiketsu-labs/claude-deck` and `/plugin install deck@claude-deck`).
- **VS Code extension distribution**: Built into `vscode/claude-deck-<version>.vsix` via `python3 vscode/package.py` for GitHub Releases, VS Code Marketplace (`vsce publish --packagePath ...`), and Open VSX (`ovsx publish ...`).
