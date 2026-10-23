---
name: finish-task
description: Use when the work on a ticket is done and the user wants a tracker comment handing it over, e.g. "/finish-task", "write the Jira handoff", "draft a ticket comment", "summarise this for the ticket".
argument-hint: [PROJ-123 | #42]
allowed-tools: [AskUserQuestion, Bash, Skill]
---

# Finish a task

Draft a handoff comment on what the work on a ticket produced. Post it only once the user approves.

## 1. Ticket

Take the first ticket key (`[A-Z][A-Z0-9]+-\d+` for Jira/Linear, or `#\d+` / `owner/repo#\d+` for GitHub/GitLab; with `$TICKET_PROJECTS` set, such as `PROJ,OPS`, only those projects' keys, any case) from the arguments, else the key in the session name's `(<KEY>)` suffix. None: ask with AskUserQuestion.

## 2. Gather

- The ticket, for its acceptance criteria, using whatever tool is available:
  - A loaded tracker MCP tool or skill (Jira, Linear, GitHub, etc.)
  - For `#42` or `owner/repo#42`: `gh issue view <NUMBER> [--repo <owner/repo>] --json title,body,state,url`
  - For Jira keys when `$JIRA_URL` and `$JIRA_TOKEN` are set: `curl -s -H "Authorization: Bearer $JIRA_TOKEN" "$JIRA_URL/rest/api/2/issue/<TICKET>?fields=summary,description,status,issuetype"`
- Its PRs in every state (if `gh` is available): `gh search prs <TICKET> --json repository,number,title,state,isDraft,url`. A merged PR reads `closed` there; `--merged` on the same search lists which are.
- From this session: what changed, which tests ran (the repo's checks, acceptance tests), what stays open.

## 3. Draft

English, terse. Leave out a section with nothing in it. Use Markdown for GitHub/Linear tickets and Jira wiki markup (`h3.`, `(/)`, `(x)`, `[text|url]`) for Jira tickets:

```
### Status
<1-3 sentences: what holds now>

### Acceptance Criteria
- [x] <AC>, <what meets it>
- [ ] <AC>, <what is missing>

### PRs
- [<repo>#<n>](<url>) <title>, <merged | open | draft | closed>

### Tests
- <what ran, with result>

### Open
- <follow-up, risk, question>
```

State only what the PRs, the ticket or this session show. No guesses about deploy or release state.

## 4. Post

Show the draft, then ask with AskUserQuestion: `Post`, `Don't post`; changes via Other, then show the new draft and ask again. On `Post`, post the comment with the loaded tracker MCP tool, or:

- **GitHub Issue (`#42` or `owner/repo#42`):**
  ```bash
  gh issue comment <NUMBER> [--repo <owner/repo>] --body "$DRAFT"
  ```
- **Jira (`PROJ-123`):**
  ```bash
  curl -s -X POST -H "Authorization: Bearer $JIRA_TOKEN" -H "Content-Type: application/json" \
    "$JIRA_URL/rest/api/2/issue/<TICKET>/comment" -d "$(jq -n --arg body "$DRAFT" '{body: $body}')" | jq -r .id
  ```
  Report `$JIRA_URL/browse/<TICKET>?focusedCommentId=<id>`.

## 5. Worktrees

Run the cleanup-worktrees listing (`scripts/list.sh <root>` in the cleanup-worktrees skill's directory, `<root>` the session's project root) and keep the `remove` lines whose branch or path names the ticket (any case). None: say nothing. Otherwise list them and ask with AskUserQuestion, "Remove the N worktrees of <TICKET> whose PR is merged or closed?", `Remove (Recommended)`, `Keep`; on `Remove`, remove them as cleanup-worktrees step 3 does.
