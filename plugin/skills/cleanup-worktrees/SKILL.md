---
name: cleanup-worktrees
description: Use when the user asks to clean up, prune or list stale worktrees in a repo and the repos cloned beneath it, e.g. "cleanup worktrees", "remove merged worktrees", "which worktrees can go". Triggers on "/cleanup-worktrees".
allowed-tools: [AskUserQuestion, Bash]
---

# Clean up worktrees

Remove the worktrees under `<repo>/.claude/worktrees/` (the root repo and every git repo directly beneath it) whose work has landed.

## 1. List

```bash
<this skill's directory>/scripts/list.sh <root> > "$CLAUDE_JOB_DIR/tmp/worktrees.tsv"   # <root>: the session's project root; any scratch file
```

One TSV line per worktree: `verdict  reason  repo  branch  path`.

| Verdict | Means |
|---|---|
| `remove` | PR merged or closed, its head holds the worktree's HEAD, nothing uncommitted, no live session on it |
| `check` | No PR and the branch is not on origin, a closed PR missing local commits, or a detached HEAD |
| `keep` | Open PR, pushed branch without PR, uncommitted changes, or a working/blocked job runs in it |

## 2. Ask

Show the counts per verdict, then the `remove` lines grouped by repo (repo, branch, reason) and each `check` line with its reason. Leave `keep` at its counts.

Ask with AskUserQuestion: "Remove the N worktrees marked remove?", options `Remove all (Recommended)`, `None`; free text via Other names exceptions or `check` lines to add. A `check` line goes only when the user names it.

## 3. Remove

For each chosen line, with `<repo>` the path up to `/.claude/worktrees/`:

```bash
git -C <repo> worktree remove <path>        # never --force: a worktree that gained changes stays
git -C <repo> branch -D <branch>            # only once the remove succeeded, and not for a detached HEAD
```

Report removed and kept counts, and each worktree `worktree remove` refused, with its reason.
