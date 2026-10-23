---
name: finish-task
description: Use when the work on a ticket is done and the user wants a Jira comment handing it over, e.g. "/finish-task", "write the Jira handoff", "draft a ticket comment", "summarise this for the ticket".
argument-hint: [PROJ-123]
allowed-tools: [AskUserQuestion, Bash, Skill]
---

# Finish a task

Draft a Jira comment on what the work on a ticket produced. Post it only once the user approves.

## 1. Ticket

Take the first Jira key (`[A-Z][A-Z0-9]+-\d+`; with `$TICKET_PROJECTS` set, such as `PROJ,OPS`, only those projects' keys, any case; stored upper-case) from the arguments, else the key in the session name's `(PROJ-123)` suffix. None: ask with AskUserQuestion.

## 2. Gather

- The ticket, for its acceptance criteria, with a Jira skill or tool if one is loaded, else `curl -s -H "Authorization: Bearer $JIRA_TOKEN" "$JIRA_URL/rest/api/2/issue/<TICKET>?fields=summary,description,status,issuetype"`.
- Its PRs in every state: `gh search prs <TICKET> --json repository,number,title,state,isDraft,url`. A merged PR reads `closed` there; `--merged` on the same search lists which are.
- From this session: what changed, which tests ran (the repo's checks, acceptance tests), what stays open.

## 3. Draft

English, Jira wiki markup, terse. Leave out a section with nothing in it.

```
h3. Status
<1-3 sentences: what holds now>

h3. Acceptance Criteria
(/) <AC>, <what meets it>
(x) <AC>, <what is missing>

h3. PRs
* [<repo>#<n>|<url>] <title>, <merged | open | draft | closed>

h3. Tests
* <what ran, with result>

h3. Open
* <follow-up, risk, question>
```

State only what the PRs, the ticket or this session show. No guesses about deploy or release state.

## 4. Post

Show the draft, then ask with AskUserQuestion: `Post`, `Don't post`; changes via Other, then show the new draft and ask again. On `Post`:

```bash
curl -s -X POST -H "Authorization: Bearer $JIRA_TOKEN" -H "Content-Type: application/json" \
  "$JIRA_URL/rest/api/2/issue/<TICKET>/comment" -d "$(jq -n --arg body "$DRAFT" '{body: $body}')" | jq -r .id
```

Report `$JIRA_URL/browse/<TICKET>?focusedCommentId=<id>`.

## 5. Worktrees

Run the cleanup-worktrees listing (`scripts/list.sh <root>` in the cleanup-worktrees skill's directory, `<root>` the session's project root) and keep the `remove` lines whose branch or path names the ticket (any case). None: say nothing. Otherwise list them and ask with AskUserQuestion, "Remove the N worktrees of <TICKET> whose PR is merged or closed?", `Remove (Recommended)`, `Keep`; on `Remove`, remove them as cleanup-worktrees step 3 does.
