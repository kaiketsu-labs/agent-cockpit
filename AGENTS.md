# AGENTS.md

Instructions and architectural overview for AI coding agents working on **Agent Cockpit**.

## Project Overview

Agent Cockpit consists of two halves that communicate asynchronously via JSON files in `~/.claude/cockpit/` (with legacy fallback to `~/.claude/deck/`) and Claude Code's native JSONL transcripts in `~/.claude/projects/`:

1. **Claude Code Plugin (`plugin/`)** — Named `cockpit`. Runs inside each Claude Code session:
   - [`plugin/hooks/register.tsx`](plugin/hooks/register.tsx) & [`plugin/hooks/group.ts`](plugin/hooks/group.ts): Session lifecycle hooks (`session.start`, `prompt.submit`, `tool.call`, `turn.complete`, `session.end`), silent background session naming & folder classification via `$.model.complete({ model: 'haiku' })` (with `$.model.fork` fallback), `/retitle [hint]` slash command (`handleRetitleCommand` using `$.model.fork` with full-transcript `extractTranscriptContext` fallback), zero-cost regex ticket detection from prompts and CLI commands (`acli`, `jira`, `gh`, `git checkout`), direct `custom-title` JSONL writes, and MCP tools (`name_session`, `set_ticket_titles`, `keep_warm`).
   - [`plugin/skills/`](plugin/skills/): Optional companion skills (`start-task`, `finish-task`, `cleanup-worktrees`).
   - [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) & [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json): Claude Code plugin manifests.

2. **VS Code Extension (`vscode/`)** — Named `agent-cockpit`. Renders the webview sidebar and status bar:
   - [`vscode/extension.js`](vscode/extension.js): VS Code activation, `WebviewViewProvider`, status bar item, file watchers on `~/.claude/cockpit/` and `~/.claude/deck/`, interactive terminal discovery (`ps -o ppid=` on macOS, `/proc/<pid>/stat` on Linux), automatic VS Code terminal tab renaming (`workbench.action.terminal.renameWithArg`), folder & session management commands (`newFolder`, `renameFolder`, `moveToFolder`, `rename`, `autoRename`), and issue/PR polling (3-stage Jira cascade: REST API -> `acli` -> `jira-cli`; GitHub Issues & PRs via `gh`; custom `trackerCommand`).
   - [`vscode/inbox.js`](vscode/inbox.js): Self-contained Webview UI rendering top-level project/ticket folder cards, standalone ungrouped session cards, live status orbs, prompt cache countdowns, keyboard navigation (`/`, `↑`/`↓`, `Enter`, `Esc`), zero-layout-jump action overlays, and drag-and-drop ordering.
   - [`vscode/group.js`](vscode/group.js): Pure grouping, folder & ticket normalization (`normalizeFolder`, `normalizeTicket`, `folderOf`, `ticketOf`, `folderTicket`), directory normalization (`shortCwd`), full-transcript context extraction & classification helpers (`extractTranscriptContext`, `buildClassificationInstruction`, `parseClassificationReply`), JSONL `custom-title` helpers (`encodeProjectPath`, `customTitleLine`), sorting, and state normalization logic.
   - [`vscode/package.py`](vscode/package.py): Zero-dependency Python script that packages the extension into a `.vsix` archive.

## Key Design Constraints

- **Zero npm dependencies in `vscode/`**: Keep the VS Code extension in plain CommonJS JavaScript (`extension.js`, `inbox.js`, `group.js`) using only built-in Node.js modules and the `vscode` API. Do not add a build step or `node_modules` to `vscode/`.
- **Keep `group.ts` and `group.js` aligned**: Folder and ticket parsing (`normalizeFolder`, `normalizeTicket`, `folderOf`, `ticketOf`, `extractTicket`, `encodeProjectPath`, `customTitleLine`, `shortCwd`) and session state logic live in both [`plugin/hooks/group.ts`](plugin/hooks/group.ts) and [`vscode/group.js`](vscode/group.js). When updating folder/ticket recognition rules or session schema fields, update both and their respective test suites.
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

## Asset & Visual Rendering (Mandatory Rules)

- **Always re-render `assets/sidebar.png` whenever `assets/sidebar.svg` changes**:
  - Run `sh assets/render.sh` to generate the 2x raster image (`960x1080`) required by the VS Code Marketplace.
- **Never use CSS color keywords like `transparent` in SVG elements**:
  - Native macOS AppKit and CoreGraphics vector renderers do NOT recognize CSS keywords like `transparent` in `fill` attributes. They treat them as unknown values and fallback to solid opaque black (`#000000`), creating unwanted dark boxes/artifacts around icons.
  - Always use valid SVG `fill="none"` or omit invisible background bounding boxes altogether.
- **Header action icons must match Codicons outline stroke style**:
  - Keep title bar icons matching VS Code's native Codicons: thin 1.1–1.3px line strokes (`stroke="#cccccc" stroke-width="1.2" fill="none"`). Do not use solid filled polygons or unstroked blobs for action icons.

## Development & Branch Hygiene (Mandatory)

- **Always start from latest `origin/main`**:
  - Before starting any task or writing code, fetch the latest `main`: `git fetch origin main`
  - When creating a new branch, branch strictly from `origin/main`: `git checkout -b <branch-name> origin/main`
  - When working on an existing branch, always rebase onto `origin/main` first: `git fetch origin main && git rebase origin/main`
  - Never let feature branches fall behind `main`. The repo uses `.githooks/pre-push` to reject any push where the branch is behind `origin/main`.
- **Pre-commit validation**:
  - Git hooks in `.githooks/` run `node --check` and `node --test` automatically in <150ms before every commit. Enable them once with `sh .githooks/setup.sh`.
- **Local Testing & Dev Tools**:
  - Press `F5` in VS Code to launch the Extension Development Host window running the local code live (isolated from the installed Marketplace extension).
  - Run `python3 vscode/package.py --install` to build and install the VSIX locally into your active VS Code profile.

## Releasing & Shipping

- **NEVER merge or release autonomously**: Agents must NEVER run `gh pr merge`, push directly to `main`, or merge release PRs on their own. Merging PRs and cutting releases is strictly restricted to the user. Agents only prepare branches, run tests, and open PRs.
- **Automated releases via Release Please**: Pushing Conventional Commits (`feat:`, `fix:`, etc.) to `main` causes [`.github/workflows/release.yml`](.github/workflows/release.yml) to open/update a Release PR that bumps [`vscode/package.json`](vscode/package.json), [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json), [`README.md`](README.md), and `CHANGELOG.md` via [`release-please-config.json`](release-please-config.json). Merging that PR creates the GitHub Release, builds and attaches `agent-cockpit-<version>.vsix`, and publishes to VS Code Marketplace / Open VSX if tokens are configured.
- **Never manually bump versions**: Never manually edit the `version` field in [`vscode/package.json`](vscode/package.json), [`plugin/.claude-plugin/plugin.json`](plugin/.claude-plugin/plugin.json), or [`.release-please-manifest.json`](.release-please-manifest.json). Version bumps, tagging, and changelog generation are handled strictly and exclusively by Release Please. Manually bumping version numbers desynchronizes the manifest from Git tags and causes Release Please to calculate incorrect version jumps and duplicate changelog history.
- **Plugin distribution**: Distributed directly from this GitHub repository via `.claude-plugin/marketplace.json` (`/plugin marketplace add kaiketsu-labs/agent-cockpit` and `/plugin install cockpit@agent-cockpit`).
- **VS Code extension distribution**: Built into `vscode/agent-cockpit-<version>.vsix` via `python3 vscode/package.py` for GitHub Releases, VS Code Marketplace (`vsce publish --packagePath ...`), and Open VSX (`ovsx publish ...`).
