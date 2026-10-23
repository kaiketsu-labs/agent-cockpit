# AGENTS.md

Instructions and architectural overview for AI coding agents working on **Claude Deck**.

## Project Overview

Claude Deck consists of two halves that communicate asynchronously via JSON files in `~/.claude/deck/`:

1. **Claude Code Plugin (`plugin/`)** — Named `deck`. Runs inside each Claude Code session:
   - [`plugin/hooks/register.tsx`](plugin/hooks/register.tsx) & [`plugin/hooks/group.ts`](plugin/hooks/group.ts): Session lifecycle hooks (`session.start`, `prompt.submit`, `tool.call`, `tool.result`, `turn.complete`, `session.end`) and MCP tools (`name_session`, `set_ticket_titles`).
   - [`plugin/skills/`](plugin/skills/): Optional companion skills (`start-task`, `finish-task`, `cleanup-worktrees`).
   - [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) & [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json): Claude Code plugin manifests.

2. **VS Code Extension (`vscode/`)** — Named `kaiketsu-labs.claude-deck`. Renders the sidebar and status bar:
   - [`vscode/extension.js`](vscode/extension.js): VS Code activation, `TreeDataProvider`, status bar item, file watchers on `~/.claude/deck/`, interactive terminal discovery (`ps -o ppid=` on macOS, `/proc/<pid>/stat` on Linux), and issue/PR polling (`Jira`, `GitHub Issues`, custom `trackerCommand`, `gh pr list`).
   - [`vscode/group.js`](vscode/group.js): Pure grouping, ticket extraction (`PROJ-123`, `#42`, `owner/repo#42`, or custom regex), sorting, and state normalization logic.
   - [`vscode/package.py`](vscode/package.py): Zero-dependency Python script that packages the extension into a `.vsix` archive.

## Key Design Constraints

- **Zero npm dependencies in `vscode/`**: Keep the VS Code extension in plain CommonJS JavaScript (`extension.js`, `group.js`) using only built-in Node.js modules and the `vscode` API. Do not add a build step or `node_modules` to `vscode/`.
- **Keep `group.ts` and `group.js` aligned**: Ticket parsing (`normalizeTicket`, `ticketOf`, `nameTicket`) and session state logic live in both [`plugin/hooks/group.ts`](plugin/hooks/group.ts) and [`vscode/group.js`](vscode/group.js). When updating ticket recognition rules or session schema fields, update both and their respective test suites.
- **Non-intrusive `name_session`**: Calling `mcp__deck__name_session` writes `name` and `ticket` immediately to `~/.claude/deck/sessions/<id>.json` and queues `/rename` for `turn.complete`. Never abort the turn (`endTurn`) or inject synthetic resume prompts.
- **Silent unconfigured trackers**: In `"auto"` mode (`claudeDeck.tracker` and `claudeDeck.pullRequests`), missing `JIRA_URL`/`JIRA_TOKEN` or unauthenticated `gh` CLI must fail silently without showing error banners in the sidebar.
- **No scope creep**: Keep the plugin focused on session tracking, naming, and ticket grouping. Do not add generic security scanners, file-locking guards, or greedy regex extraction on normal conversation prompts.

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

- **Version bumps**: Keep versions synchronized across [`vscode/package.json`](vscode/package.json) and [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json).
- **Plugin distribution**: Distributed directly from this GitHub repository via `.claude-plugin/marketplace.json` (`/plugin marketplace add kaiketsu-labs/claude-deck` and `/plugin install deck@claude-deck`).
- **VS Code extension distribution**: Built into `vscode/claude-deck-<version>.vsix` via `python3 vscode/package.py` for GitHub Releases, VS Code Marketplace (`vsce publish --packagePath ...`), and Open VSX (`ovsx publish ...`).
