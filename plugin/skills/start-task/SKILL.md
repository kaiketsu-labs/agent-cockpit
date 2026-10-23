---
name: start-task
description: Binds the session to a Jira ticket, names it "<summary> (PROJ-123)" and sets up worktrees on demand. Runs only when the user calls /start-task.
disable-model-invocation: true
argument-hint: [PROJ-123] <task>
allowed-tools: [AskUserQuestion, Bash, Skill, EnterPlanMode, ExitPlanMode, EnterWorktree, mcp__deck__name_session]
---

# Start a task

Bind the session to a ticket, name it, then work on the task as stated. The ticket is context and grouping, not the task: the task may be an investigation or something merely related to the ticket.

## 1. Ticket

Take the first Jira key (`[A-Z][A-Z0-9]+-\d+`; with `$TICKET_PROJECTS` set, such as `PROJ,OPS`, only those projects' keys, any case; stored upper-case) from the arguments or the prompt. None: ask with AskUserQuestion, "Which Jira ticket does this belong to?", options `No ticket` plus free text via Other. On `No ticket`, skip steps 2 and 3.

## 2. Fetch

Fetch the ticket with a Jira skill or tool if one is loaded, else `curl -s -H "Authorization: Bearer $JIRA_TOKEN" "$JIRA_URL/rest/api/2/issue/<TICKET>?fields=summary,description,status,issuetype"`, and its open PRs: `gh search prs <TICKET> --state open`. If the fetch fails, say so and go on without its content.

## 3. Name

Call `mcp__deck__name_session` right after the fetch, with:

- `summary`: 3-6 English words on what this session does, written by you from the prompt's task, else from the ticket's content. Not the Jira summary verbatim.
- `ticket`: the key.
- `title`: the ticket's Jira summary shortened to at most 6 words, in English. The Claude Deck sidebar shows it beside the key. Leave it out when the fetch failed.

Then end the turn with one line saying so: the rename runs between turns, and the mod resumes this skill at step 4. If the tool is missing (mod not loaded), tell the user to run `/rename <summary> (<ticket>)` and go on.

## 4. Task

The task is what the prompt asks beyond the ticket key; a stated task stands. Ask how to approach it with AskUserQuestion unless the prompt names the approach ("plan", "implement", "just answer", "review"): "How should this session approach <the task in a few words>?", or "What should this session do with <TICKET>?" when the prompt holds no task (only the key, or "work on it"). Put the option the task, else the ticket, suggests first and mark it `(Recommended)`, its description saying why in one line:

| Option | Recommend when | Then |
|---|---|---|
| Implement directly | Small and clear: concrete acceptance criteria, one repo, a change you can name in a sentence | Implement in worktrees, run the repo's checks |
| Investigate + plan | Unclear, large or cross-repo; open design questions; no acceptance criteria | `EnterPlanMode`; read the code, show the plan in full in chat, then `ExitPlanMode`. Implement only once the user approves it. A session backgrounded in plan mode gets a new plan path, so its dialog shows no plan |
| Investigate only | The ticket asks a question or an analysis, no code change | Answer or analyse, no plan, no edits |
| Review | Open PRs carry the change and await review | Review those PRs |

Free text via Other is a task of its own. With no stated task and no fetched ticket, recommend nothing.

## 5. Worktrees, on demand

Create none up front, and none for read-only work. Before the first edit in a repo:

| Where | Do |
|---|---|
| The session's own repo | `EnterWorktree` with name `<TICKET>-<slug>` |
| Another repo, e.g. one cloned beneath it | `git -C <repo> fetch origin` then `git -C <repo> worktree add .claude/worktrees/<TICKET>-<slug> -b <type>/<TICKET>-<slug> origin/<default branch>`, then set it up as the repo's README or CLAUDE.md says (dependencies, env) |

- `<type>` is a Conventional-Commit type, `<slug>` a short kebab-case slug.
- Already a worktree under `<repo>/.claude/worktrees/<TICKET>*` (`git -C <repo> worktree list`): ask whether to reuse it or start a new one. Two sessions must not share one.
- Edit and run tests only inside the worktree. Its branch is the PR's branch.

## 6. Work

Go on with the task. Once its PRs are up or the analysis is done, offer `/finish-task` for the Jira handoff.
