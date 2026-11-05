# AGENTS.md

Instructions and architectural overview for AI coding agents working on **Agent Cockpit**.

## Project Overview

Agent Cockpit consists of two halves that communicate asynchronously via JSON files in `~/.claude/cockpit/` (with legacy fallback to `~/.claude/deck/`) and Claude Code's native JSONL transcripts in `~/.claude/projects/`:

1. **Claude Code Plugin (`plugin/`)** — Named `cockpit`. Runs inside each Claude Code session:
   - [`plugin/hooks/register.tsx`](plugin/hooks/register.tsx) & [`plugin/hooks/group.ts`](plugin/hooks/group.ts): Session lifecycle hooks (`session.start`, `prompt.submit`, `tool.call`, `turn.complete`, `session.end`), silent background session naming & folder classification via `$.model.complete({ model: 'haiku' })` (with `$.model.fork` fallback), zero-cost regex ticket detection from prompts and CLI commands (`acli`, `jira`, `gh`, `git checkout`), direct `custom-title` JSONL writes, and MCP tools (`name_session`, `set_ticket_titles`, `keep_warm`).
   - [`plugin/skills/`](plugin/skills/): Optional companion skills (`start-task`, `finish-task`, `cleanup-worktrees`).
   - [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) & [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json): Claude Code plugin manifests.

2. **VS Code Extension (`vscode/`)** — Named `agent-cockpit`. Renders the webview sidebar and status bar:
   - [`vscode/extension.js`](vscode/extension.js): VS Code activation, `WebviewViewProvider`, status bar item, file watchers on `~/.claude/cockpit/` and `~/.claude/deck/`, interactive terminal discovery (`ps -o ppid=` on macOS, `/proc/<pid>/stat` on Linux), automatic VS Code terminal tab renaming (`workbench.action.terminal.renameWithArg`), folder & session management commands (`newFolder`, `renameFolder`, `moveToFolder`, `rename`), and issue/PR polling (3-stage Jira cascade: REST API -> `acli` -> `jira-cli`; GitHub Issues & PRs via `gh`; custom `trackerCommand`).
   - [`vscode/inbox.js`](vscode/inbox.js): Self-contained Webview UI rendering top-level project/ticket folder cards, standalone ungrouped session cards, live status orbs, prompt cache progress bars, and drag-and-drop ordering.
   - [`vscode/group.js`](vscode/group.js): Pure grouping, folder & ticket normalization (`normalizeFolder`, `normalizeTicket`, `folderOf`, `ticketOf`, `folderTicket`), JSONL `custom-title` helpers (`encodeProjectPath`, `customTitleLine`), sorting, and state normalization logic.
   - [`vscode/package.py`](vscode/package.py): Zero-dependency Python script that packages the extension into a `.vsix` archive.

## Key Design Constraints

- **Zero npm dependencies in `vscode/`**: Keep the VS Code extension in plain CommonJS JavaScript (`extension.js`, `inbox.js`, `group.js`) using only built-in Node.js modules and the `vscode` API. Do not add a build step or `node_modules` to `vscode/`.
- **Keep `group.ts` and `group.js` aligned**: Folder and ticket parsing (`normalizeFolder`, `normalizeTicket`, `folderOf`, `ticketOf`, `extractTicket`, `encodeProjectPath`, `customTitleLine`) and session state logic live in both [`plugin/hooks/group.ts`](plugin/hooks/group.ts) and [`vscode/group.js`](vscode/group.js). When updating folder/ticket recognition rules or session schema fields, update both and their respective test suites.
- **Silent, non-intrusive session naming**:
  - Never mutate `e.text` in `prompt.submit` (doing so alters the user's visible prompt in the terminal).
  - Automatic naming runs silently in the background via `$.clock.after(10, ...)` and `$.model.complete({ model: 'haiku' })`, triggered once when a session is unnamed; once named, names remain stable and focused on the overarching session goal (never overwritten on subtasks or ticket binding).
  - Both plugin and sidebar renames write `name`, `folder`, and `ticket` directly to `~/.claude/cockpit/sessions/<id>.json` and append a `{"type":"custom-title","customTitle":...,"sessionId":...}` line to `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`.
- **Silent unconfigured trackers**: In `"auto"` mode (`agentCockpit.tracker` and `agentCockpit.pullRequests`), missing `JIRA_URL`/`JIRA_TOKEN` or unauthenticated `gh` / `acli` / `jira` CLIs must fail silently without showing error banners in the sidebar.
- **Never manually bump versions or package manifests**: Everything runs through Release Please. Never edit `version` in [`vscode/package.json`](vscode/package.json), [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json), or [`.release-please-manifest.json`](.release-please-manifest.json), and never manually upload `.vsix` files in the browser. Releases, version bumps, changelogs, Git tags, and store publishing (VS Code Marketplace & Open VSX) are handled strictly and exclusively by Release Please and GitHub Actions.
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

- **NEVER merge or release autonomously**: Agents must NEVER run `gh pr merge`, push directly to `main`, or merge release PRs on their own. Merging PRs and cutting releases is strictly restricted to the user. Agents only prepare branches, run tests, and open PRs.
- **Automated releases via Release Please**: Pushing Conventional Commits (`feat:`, `fix:`, etc.) to `main` causes [`.github/workflows/release.yml`](.github/workflows/release.yml) to open/update a Release PR that bumps [`vscode/package.json`](vscode/package.json), [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json), [`README.md`](README.md), and `CHANGELOG.md` via [`release-please-config.json`](release-please-config.json). Merging that PR creates the GitHub Release, builds and attaches `agent-cockpit-<version>.vsix`, and publishes to VS Code Marketplace / Open VSX if tokens are configured.
- **Never manually bump versions**: Never manually edit the `version` field in [`vscode/package.json`](vscode/package.json), [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json), or [`.release-please-manifest.json`](.release-please-manifest.json). Version bumps, tagging, and changelog generation are handled strictly and exclusively by Release Please. Manually bumping version numbers desynchronizes the manifest from Git tags and causes Release Please to calculate incorrect version jumps and duplicate changelog history.
- **Plugin distribution**: Distributed directly from this GitHub repository via `.claude-plugin/marketplace.json` (`/plugin marketplace add kaiketsu-labs/agent-cockpit` and `/plugin install cockpit@agent-cockpit`).
- **VS Code extension distribution**: Built into `vscode/agent-cockpit-<version>.vsix` via `python3 vscode/package.py` for GitHub Releases, VS Code Marketplace (`vsce publish --packagePath ...`), and Open VSX (`ovsx publish ...`).
