<p align="center">
  <img src="assets/banner.png" alt="Claude Deck: All your Claude Code sessions, one deck." width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-e8825a"></a>
  <img alt="VS Code extension" src="https://img.shields.io/badge/VS%20Code-extension-3794ff">
  <img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-cc785c">
  <img alt="Status: early" src="https://img.shields.io/badge/status-early-yellow">
</p>

<p align="center">
  <b>Run five Claude Code sessions at once without losing track of any of them.</b><br>
  Claude Deck puts every background and interactive session in one VS Code sidebar, grouped by the ticket it works on,<br>
  with live status, ticket status, open PRs and a ping when a session needs you.
</p>

---

## Why

Claude Code is great at working in the background. Start a few `claude --bg` jobs, open a couple of interactive sessions, and twenty minutes later you have no idea which one is waiting for approval, which one is done, and which terminal tab belongs to which ticket.

Claude Deck is the overview: **one list, grouped by ticket, that tells you what each session is doing and takes you there in one click.**

<p align="center">
  <img src="assets/sidebar.svg" alt="The Claude Deck sidebar: sessions grouped by ticket with status icons, an open PR, a needs-input notification, and History and Legend sections" width="460">
  <br><sub>Illustration with sample data</sub>
</p>

## Features

| | |
|---|---|
| 🗂️ **Grouped by ticket** | Sessions bound to `PROJ-123`, `#42` or `owner/repo#42` gather under their ticket; everything else sits below a divider. |
| 🚦 **Live status & activity** | Working, needs input, idle, failed, done, plus active tool call (`npm test`, `Read auth.ts`, …) while running. |
| 🔔 **Needs-input alerts** | A notification with an **Open** button the moment a session waits for you, even with the sidebar closed. |
| 📊 **Status bar widget** | `$(bell-dot) Claude (1 waiting)` shows running/waiting sessions in your VS Code footer; one click jumps in. |
| 🖱️ **One click to jump in** | Attaches a background job in an editor tab, focuses the terminal of an interactive one (macOS & Linux), or resumes an ended one. |
| ⏱️ **Prompt cache countdown** | `cache 4:12` shows how long until a session's prompt cache goes cold, so you know when replying is cheap. |
| 🎫 **Pluggable tracker & PRs** | Jira, GitHub Issues (`#42`), a custom shell command, or none; open GitHub PRs per ticket (optional). |
| ✏️ **Instant session naming** | `name_session` updates the sidebar immediately without interrupting the turn, and `/rename` from the sidebar applies once idle. |
| 🧹 **Self-tidying** | Closed tickets and sessions quiet for a week move to History. Drag to reorder; the order is shared across windows. |
| 🔎 **Search** | Find any session, including History, by name, ticket key or title. |

## How it works

Claude Deck has two halves that talk through small files in `~/.claude/deck/`:

```mermaid
flowchart LR
    subgraph CC["Claude Code"]
        S1["session"]
        S2["session"]
        S3["background job"]
        P["deck plugin"]
    end
    subgraph Files["~/.claude/deck/"]
        F1["sessions/*.json"]
        F2["renames/"]
        F3["view.json"]
    end
    subgraph VS["VS Code"]
        X["Claude Deck sidebar"]
    end
    S1 & S2 & S3 -.- P
    P -- "records name, ticket, detail, cwd, last turn" --> F1
    F1 --> X
    X -- "rename request" --> F2
    F2 -- "applied when idle" --> P
    X <-- "order, hidden" --> F3
    X -- "claude agents --json" --> CC
    X -. "optional" .-> J["Jira / GitHub / Custom"]
```

- The **`deck` plugin** runs inside every Claude Code session. It writes one tiny JSON file per session (`name`, `ticket`, `detail`, `cwd`, `lastTurnEndAt`) and applies renames the sidebar asks for. It never touches transcripts.
- The **VS Code extension** merges those files with `claude agents --json --all` and renders the deck.

## The ticket workflow

The plugin also ships three skills that make sessions ticket-aware. They're optional, and meant as a starting point for your own workflow.

```mermaid
sequenceDiagram
    actor You
    participant Deck as Claude Deck
    participant S as Claude session
    participant T as Tracker / GitHub
    You->>Deck: + Start task "PROJ-142 add PDF export"
    Deck->>S: claude --bg -n "add PDF export (PROJ-142)" "/start-task PROJ-142 …"
    S->>T: fetch ticket, open PRs
    S->>S: name_session → "PDF export endpoint (PROJ-142)"
    Deck-->>You: session updates under PROJ-142 immediately
    S->>You: how should I approach it? (needs input 🔔)
    You->>Deck: Open
    Note over S: works in its own git worktree
    You->>S: /finish-task
    S->>T: handoff comment (after your OK)
```

| Skill | What it does |
|---|---|
| `/start-task [KEY] <task>` | Fetches the ticket (via MCP, `gh` or Jira REST), names the session `<summary> (KEY)` without interrupting the turn, asks how to approach the task, creates git worktrees on demand |
| `/finish-task [KEY]` | Drafts a handoff comment (status, acceptance criteria, PRs, tests) and posts it once you approve |
| `/cleanup-worktrees` | Removes worktrees whose PR is merged or closed |

## Install

**1. The Claude Code plugin**

```text
/plugin marketplace add kaiketsu-labs/claude-deck
/plugin install deck@claude-deck
```

or load it from a checkout with `CLAUDE_CODE_PLUGIN_DIRS=/path/to/claude-deck/plugin`.

**2. The VS Code extension**

Download `claude-deck-0.1.0.vsix` from the [latest GitHub Release](https://github.com/kaiketsu-labs/claude-deck/releases/latest) and install it:

```bash
code --install-extension claude-deck-0.1.0.vsix --force
```

Or build it from source (no npm needed — `package.py` zips the extension into a `.vsix`):

```bash
git clone https://github.com/kaiketsu-labs/claude-deck
cd claude-deck/vscode
python3 package.py && code --install-extension claude-deck-0.1.0.vsix --force
```

**3. Open the deck** from the activity bar. That's it. Ticket status and PRs are optional, see below.

## Configuration

Configure Claude Deck via **VS Code Settings** (`claudeDeck.*`) or via the `env` blocks of `~/.claude/settings.json` and `.claude/settings.json`:

| VS Code Setting | Env Fallback | Default | Effect |
|---|---|---|---|
| `claudeDeck.tracker` | — | `"auto"` | `"auto"` (Jira for `PROJ-123` when `JIRA_URL`/`JIRA_TOKEN` are set, GitHub Issues for `#42` / `owner/repo#42` via `gh`, silent when unconfigured), `"jira"`, `"github"`, `"command"`, or `"none"`. |
| `claudeDeck.trackerCommand` | `DECK_TRACKER_COMMAND` | `""` | Shell command for `"command"` mode. Receives JSON array of keys on stdin and outputs `{ "KEY": { "status", "category", "summary", "url" } }`. |
| `claudeDeck.pullRequests` | — | `"auto"` | `"auto"` (queries GitHub via `gh` when available, silent when unconfigured), `"github"`, or `"none"`. |
| `claudeDeck.ticketProjects` | `TICKET_PROJECTS` | `""` | Comma-separated project keys, e.g. `PROJ,OPS`. Narrows Jira-style keys (case-insensitive). Default: any `ABC-123` or `#42` / `owner/repo#42` key. |
| `claudeDeck.ticketPattern` | — | `""` | Custom regular expression override for matching ticket keys. |
| `claudeDeck.startCommand` | — | `"/start-task"` | Slash command or prompt prefix passed to `claude --bg` when starting a task from the sidebar. |
| — | `JIRA_URL`, `JIRA_TOKEN` | — | Base URL and PAT for Jira status and titles (one JQL search a minute). |
| — | `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` | `5m` | Cache countdown uses one hour instead of five minutes (also honours `ENABLE_PROMPT_CACHING_1H`). |

Without Jira or `gh` everything else still works; tickets just show no status and no error banner.

## Make it yours

- **Your own workflow:** copy the skills into `~/.claude/skills/` and change anything, or point `claudeDeck.startCommand` at your own command. The sidebar groups sessions by the `ticket` field written by `name_session` or the `<summary> (<KEY>)` suffix.
- **No tickets at all?** Fine. Sessions without a key are listed below the divider, with status, live tool activity, alerts and the cache countdown.

## Roadmap

- [x] Pluggable trackers: Jira, GitHub Issues (`#42`, `owner/repo#42`), plus a `command` adapter for anything else
- [x] Configurable start command, tracker mode and ticket pattern in VS Code settings
- [x] macOS: focus the terminal of interactive sessions (`ps -o ppid=`)
- [ ] Windows: focus the terminal of interactive sessions
- [ ] VS Code Marketplace & Open VSX release

## Files

| Path | Written by | Contents |
|---|---|---|
| `~/.claude/deck/sessions/<id>.json` | plugin | name, ticket, first prompt, active tool detail, cwd, start and last turn time |
| `~/.claude/deck/renames/<id>` | sidebar | pending rename, removed once applied |
| `~/.claude/deck/view.json` | sidebar | manual order and History overrides |
| `~/.claude/deck/ticket-titles.json` | plugin | short ticket titles shown beside keys |

## Development

```text
claude-deck/
├── plugin/          Claude Code plugin "deck": hooks + skills
│   ├── hooks/       session recorder, name_session / set_ticket_titles tools
│   └── skills/      start-task, finish-task, cleanup-worktrees
└── vscode/          VS Code extension (plain JS, no build step)
```

```bash
cd vscode && node --test
```

Issues and PRs welcome.

## License

[MIT](LICENSE). Not affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic.
