#!/usr/bin/env bash
# Prints what the deploy doctor needs to diagnose one failed deploy run:
# where it failed, the trimmed failing log, and what changed since the last
# successful run of the same workflow on the same branch.
#
#   bash scripts/deploy-doctor.sh            # latest failed "Main Branch Deployment"
#   bash scripts/deploy-doctor.sh <run-id>   # a specific run
#
# Used by .github/workflows/deploy-doctor.yml and by the local
# .claude/agents/deploy-doctor.md agent — same output in both places.
# Needs: gh (authenticated), git with enough history to reach the last good run.
set -euo pipefail

LOG_LINES="${LOG_LINES:-200}"
# Files whose changes most often break a deploy without breaking the checks.
DEPLOY_SENSITIVE_PATHS=(package.json package-lock.json patches vendor .nvmrc
  meteor-backend/package.json meteor-backend/package-lock.json
  meteor-backend/.meteor .github/workflows scripts ecosystem.config.cjs)

run_id="${1:-$(gh run list --workflow main.yml --status failure --limit 1 \
  --json databaseId -q '.[0].databaseId')}"
[ -n "$run_id" ] || { echo "No failed run found." >&2; exit 1; }

meta=$(gh run view "$run_id" --json workflowName,headBranch,headSha,event,url,conclusion,createdAt,displayTitle)
field() { jq -r ".$1" <<<"$meta"; }
workflow=$(field workflowName)
branch=$(field headBranch)
sha=$(field headSha)
event=$(field event)
created=$(field createdAt)

echo "# Failed deploy run $run_id"
echo
echo "- Workflow: $workflow"
echo "- Branch: $branch  (event: $event)"
echo "- Commit: ${sha:0:8} — $(field displayTitle)"
echo "- Started: $created"
echo "- Conclusion: $(field conclusion)"
echo "- URL: $(field url)"
echo
echo "## Failed jobs and steps"
gh run view "$run_id" --json jobs -q '.jobs[] | select(.conclusion == "failure") |
  "- \(.name): " + ([.steps[] | select(.conclusion == "failure") | .name] | join(", "))'
echo
echo "## Failing log (last $LOG_LINES meaningful lines)"
echo '```'
# gh prints "job<TAB>step<TAB>timestamp line". Keep the job and the line; drop the
# echoed deploy script (ANSI cyan), npm peer-dependency noise and stack frames.
# An empty log is a valid result, so grep's "no lines" status must not abort.
gh run view "$run_id" --log-failed \
  | { grep -v $'\x1b\\[36;1m' || true; } \
  | sed $'s/\x1b\\[[0-9;]*m//g; s/\xef\xbb\xbf//' \
  | awk -F'\t' '{ line = $3; sub(/^[0-9TZ:.-]+ /, "", line); print $1 " | " line }' \
  | { grep -vE '\| (npm warn|\s+at |\s*$)' || true; } \
  | tail -n "$LOG_LINES"
echo '```'
echo

# The last success *before* this failure, started the same way: on main.yml a
# push deploys DEV while workflow_dispatch can target BETA or PROD.
good_sha=$(gh run list --workflow "$workflow" --branch "$branch" --event "$event" \
  --status success --created "<$created" --limit 1 --json headSha -q '.[0].headSha // empty')
echo "## Changes since the last successful run"
if [ -z "$good_sha" ]; then
  echo "No earlier successful $event run of \"$workflow\" on $branch."
elif ! git cat-file -e "$good_sha^{commit}" 2>/dev/null || ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
  echo "Last good commit ${good_sha:0:8} is not in local history — fetch more (git fetch --unshallow)."
else
  echo "Last good: ${good_sha:0:8}. Commits since:"
  echo '```'
  git log --oneline -50 "$good_sha..$sha"
  echo '```'
  echo "Deploy-sensitive files changed:"
  echo '```'
  git diff --stat "$good_sha" "$sha" -- "${DEPLOY_SENSITIVE_PATHS[@]}" || true
  echo '```'
fi
