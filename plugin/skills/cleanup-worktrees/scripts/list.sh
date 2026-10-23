#!/usr/bin/env bash
# Lists every worktree under <repo>/.claude/worktrees/ with a verdict, for the repo at the root (default: the
# current directory) and every git repo directly beneath it. Usage: list.sh [root]
# Output (TSV): verdict  reason  repo  branch  path
#   remove: its PR is merged or closed, nothing uncommitted, no session on it
#   check:  no PR and the branch is not on origin, HEAD differs from a closed PR's head, or a detached HEAD
#   keep:   an open PR, a pushed branch without PR, uncommitted changes, or a live session on it
set -euo pipefail

root=$(realpath "${1:-$PWD}")

live_dirs=$(jq -r 'select(.state == "working" or .state == "blocked") | .cwd, .worktreePath // empty' \
  "$HOME"/.claude/jobs/*/state.json 2>/dev/null || true)

# True when the worktree's HEAD holds nothing the PR's head lacks: same commit, an ancestor, or the same tree.
in_pr() {
  local path=$1 head=$2 number=$3
  [[ "$(git -C "$path" rev-parse HEAD)" == "$head" ]] && return 0
  git -C "$path" cat-file -e "$head" 2>/dev/null || git -C "$path" fetch -q origin "refs/pull/$number/head" 2>/dev/null || return 1
  git -C "$path" merge-base --is-ancestor HEAD "$head" 2>/dev/null || git -C "$path" diff --quiet "$head" HEAD 2>/dev/null
}

unpicked() { git -C "$1" rev-list --count "$2..HEAD" 2>/dev/null || echo "?"; }

repos=()
[[ -e "$root/.git" ]] && repos+=("$root")
for git_dir in "$root"/*/.git; do [[ -e "$git_dir" ]] && repos+=("$(dirname "$git_dir")"); done

for repo in "${repos[@]}"; do
  [[ -d "$repo/.claude/worktrees" ]] || continue
  name=$(basename "$(git -C "$repo" remote get-url origin)" .git)
  prs=$(cd "$repo" && gh pr list --state all --limit 300 --json headRefName,headRefOid,state,number 2>/dev/null || echo '[]')
  remote_branches=$(git -C "$repo" ls-remote --heads origin | sed 's|.*refs/heads/||')

  git -C "$repo" worktree list --porcelain | awk '/^worktree /{p=$2} /^branch /{print p "\t" $2} /^detached/{print p "\t"}' |
    while IFS=$'\t' read -r path ref; do
      [[ "$path" == "$repo/.claude/worktrees/"* ]] || continue
      branch=${ref#refs/heads/}
      match=$(jq -c --arg b "$branch" '[.[] | select(.headRefName == $b)] | (map(select(.state == "OPEN"))[0] // .[0])' <<<"$prs")
      pr=$(jq -r 'select(. != null) | "\(.state) #\(.number)"' <<<"$match")
      pr_head=$(jq -r 'select(. != null) | .headRefOid' <<<"$match")
      dirty=$(git -C "$path" status --porcelain 2>/dev/null | wc -l)

      if grep -qxF -e "$path" <<<"$live_dirs" || grep -q "^$path/" <<<"$live_dirs"; then
        verdict=keep reason="live session"
      elif ((dirty > 0)); then
        verdict=keep reason="$dirty uncommitted"
      elif [[ -z "$branch" ]]; then
        verdict=check reason="detached HEAD"
      elif [[ -n "$pr_head" && "$pr" != OPEN* ]] && ! in_pr "$path" "$pr_head" "${pr#*#}"; then
        verdict=check reason="$pr, $(unpicked "$path" "$pr_head") commits not in the PR"
      elif [[ "$pr" == MERGED* || "$pr" == CLOSED* ]]; then
        verdict=remove reason="$pr"
      elif [[ -n "$pr" ]]; then
        verdict=keep reason="$pr"
      elif grep -qxF -e "$branch" <<<"$remote_branches"; then
        verdict=keep reason="pushed, no PR"
      else
        verdict=check reason="local only, no PR"
      fi
      printf '%s\t%s\t%s\t%s\t%s\n' "$verdict" "$reason" "$name" "${branch:--}" "$path"
    done
done | sort
