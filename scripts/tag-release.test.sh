#!/usr/bin/env bash
# Scenario tests for tag-previous-version.sh and draft-release.sh, the scripts
# behind .github/workflows/tag-release.yml. They run against a throwaway repo
# with a bare "origin", so tags are really created and pushed, and a fake gh
# that records the Release it was asked to create. Nothing touches GitHub.
#
# Usage: scripts/tag-release.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/tag-previous-version.sh"
DRAFT="$HERE/draft-release.sh"
ROOT="$(mktemp -d)"
git init -q --bare "$ROOT/origin.git"
git clone -q "$ROOT/origin.git" "$ROOT/work" 2>/dev/null
cd "$ROOT/work"
git config user.name test; git config user.email test@example.com
git checkout -q -b main

PASS=0; FAIL=0
check() { # name, expected-substring, actual-output
  # An empty expectation means the output must be empty, not "matches anything".
  if { [ -z "$2" ] && [ -z "$3" ]; } || { [ -n "$2" ] && [[ "$3" == *"$2"* ]]; }; then echo "PASS  $1"; PASS=$((PASS+1))
  else echo "FAIL  $1"; echo "      expected: $2"; echo "      got: $3"; FAIL=$((FAIL+1)); fi
}
commit() { # version, message, [note-title]
  printf '{ "name": "t", "version": "%s" }\n' "$1" > package.json
  mkdir -p release-notes
  [ -n "${3:-}" ] && printf -- '---\nversion: %s\ndate: 2026-10-06\ntitle: %s\n---\n\nBody with title: not this\n' "$1" "$3" > "release-notes/$1.md"
  git add -A; git commit -q --allow-empty -m "$2" >/dev/null; git rev-parse HEAD
}
run() { "$SCRIPT" "$@" 2>&1; }
remote_tag() { git ls-remote --tags origin "refs/tags/$1^{}" | cut -c1-40; }

# --- history: 1.0.4 era -------------------------------------------------------
A=$(commit 1.0.4 "feature on 1.0.4" "Huddle's feed is now an inbox")
B=$(commit 1.0.4 "another 1.0.4 fix")
git push -q origin main

# 1. Ordinary merge, no bump
out=$(run "$A" "$B"); check "1. no bump → nothing tagged" "Version unchanged (1.0.4)" "$out"
check "1. no tag created" "" "$(remote_tag 1.0.4)"

# 2. Bump merges → previous version tagged on the commit before the push
C=$(commit 1.0.5 "bump to 1.0.5" "Your Redmine issues, inside TimeHuddle")
out=$(run "$B" "$C"); check "2. bump → tags 1.0.4" "Tagged 1.0.4 on $B" "$out"
check "2. tag is on origin, on the last 1.0.4 commit" "$B" "$(remote_tag 1.0.4)"
check "2. annotated, message uses the note title" "1.0.4 — Huddle's feed is now an inbox" "$(git tag -l --format='%(contents)' 1.0.4)"
check "2. tag is annotated (not lightweight)" "tag" "$(git cat-file -t 1.0.4)"

# 3. Workflow re-run of the same push → idempotent
out=$(run "$B" "$C"); check "3. re-run → no-op" "Tag 1.0.4 already on $B" "$out"

# 4. Tag already exists on a different commit → warn, leave it
git tag -a 1.0.5 "$C" -m "hand-made, on the wrong commit"; git push -q origin 1.0.5
D=$(commit 1.0.5 "late 1.0.5 fix")
E=$(commit 1.0.6 "bump to 1.0.6")
out=$(run "$D" "$E"); check "4. existing tag elsewhere → warning" "::warning::Tag 1.0.5 already exists on $C" "$out"
check "4. existing tag not moved" "$C" "$(remote_tag 1.0.5)"
echo "      exit code: $("$SCRIPT" "$D" "$E" >/dev/null 2>&1; echo $?) (0 = job stays green)"

# 5. Push that creates a branch (before = zeros)
out=$(run 0000000000000000000000000000000000000000 "$E"); check "5. new branch → skip" "No previous commit" "$out"

# 6. Force push: before is not an ancestor of after
git checkout -q -b rewritten "$C"; F=$(commit 1.0.6 "rewritten history"); git checkout -q main
out=$(run "$D" "$F"); check "6. force push → skip with warning" "not an ancestor" "$out"

# 7. One push with several commits, bump in the middle: old-version work inside
# the push shipped too, so the tag goes on the last of it, not on the pre-push SHA
G=$(commit 1.0.6 "1.0.6 work in same push")
H=$(commit 1.0.7 "bump to 1.0.7")
I=$(commit 1.0.7 "1.0.7 work in same push")
out=$(run "$E" "$I"); check "7. multi-commit push → tags last old-version commit in the push" "Tagged 1.0.6 on $G" "$out"
check "7. no title when the note file is missing" "1.0.6" "$(git tag -l --format='%(contents)' 1.0.6)"

# 8. Bump reverted (1.0.7 → 1.0.6)
J=$(commit 1.0.6 "revert bump")
out=$(run "$I" "$J"); check "8. revert of a bump → tags 1.0.7 on its last commit" "Tagged 1.0.7 on $I" "$out"

# 9. Two bumps in one push (1.0.6 → 1.0.8 via 1.0.7, already tagged above)
K=$(commit 1.0.9 "bump to 1.0.9"); L=$(commit 1.0.10 "bump to 1.0.10")
out=$(run "$J" "$L"); check "9. double bump → only the version that shipped is tagged" "1.0.6 already exists" "$out"
check "9. intermediate 1.0.9 never shipped, never tagged" "" "$(remote_tag 1.0.9)"

# 10. Dry run never writes
M=$(commit 2.0.0 "bump to 2.0.0" "Big one")
out=$(DRY_RUN=1 run "$L" "$M"); check "10. dry run prints" "Would tag 1.0.10 on $L" "$out"
check "10. dry run creates nothing" "" "$(remote_tag 1.0.10)"

# 11. Tag push rejected (origin unreachable) → job fails loudly
git remote set-url origin "$ROOT/missing.git"
"$SCRIPT" "$L" "$M" >/dev/null 2>&1; code=$?
check "11. push failure → non-zero exit (red run)" "nonzero" "$([ $code -ne 0 ] && echo nonzero || echo zero)"

# 12. Bad usage
out=$(run); check "12. missing args → usage" "usage:" "$out"


# --- draft-release.sh, with a fake gh that records what it was asked --------
git remote set-url origin "$ROOT/origin.git"
mkdir -p "$ROOT/bin"
cat > "$ROOT/bin/gh" <<'GH'
#!/usr/bin/env bash
if [ "$1 $2" = "release list" ]; then cat "$GH_RELEASES" 2>/dev/null; exit 0; fi
if [ "$1 $2" = "release create" ]; then echo "ARGS: $*" > "$GH_LOG"; cat >> "$GH_LOG"; exit 0; fi
exit 1
GH
chmod +x "$ROOT/bin/gh"; export PATH="$ROOT/bin:$PATH" GH_LOG="$ROOT/gh.log" GH_RELEASES="$ROOT/releases.txt"
: > "$GH_RELEASES"

# 13. Full chain: bump → tag → GITHUB_OUTPUT → draft
mkdir -p release-notes/assets/3.0.0
P=$(commit 3.0.0 "3.0.0 work" "Pictures and all")
printf -- '\n![The inbox](assets/3.0.0/inbox.png)\n\nSee [the docs](https://example.com/assets/x).\n' >> release-notes/3.0.0.md
git add -A; git commit -q -m "3.0.0 note image" >/dev/null; P=$(git rev-parse HEAD)
Q=$(commit 3.0.1 "bump to 3.0.1")
export GITHUB_OUTPUT="$ROOT/out.txt"; : > "$GITHUB_OUTPUT"
run "$P" "$Q" >/dev/null
check "13. tag step writes tag= for the draft step" "tag=3.0.0" "$(cat "$GITHUB_OUTPUT")"
out=$(GITHUB_REPOSITORY=acme/app "$DRAFT" 3.0.0 2>&1)
check "13. draft created" "Drafted Release 3.0.0" "$out"
log="$(cat "$GH_LOG")"
check "13. created as a draft" "--draft" "$log"
check "13. refuses to create a tag itself" "--verify-tag" "$log"
check "13. title from the note" "--title Pictures and all" "$log"
check "13. image points at the tag on raw.githubusercontent" "](https://raw.githubusercontent.com/acme/app/3.0.0/release-notes/assets/3.0.0/inbox.png)" "$log"
check "13. ordinary links untouched" "[the docs](https://example.com/assets/x)" "$log"
check "13. frontmatter stripped" "nofrontmatter" "$(grep -qE '^(version|date|title):' "$GH_LOG" && echo has || echo nofrontmatter)"
check "13. 'title:' inside the body kept" "Body with title: not this" "$log"
check "13. body starts with text, not a blank line" "Body with" "$(sed -n 2p "$GH_LOG")"

# 14. Re-run of the workflow: tag already right → still emits, draft skipped as existing
echo 3.0.0 > "$GH_RELEASES"; : > "$GITHUB_OUTPUT"; rm -f "$GH_LOG"
run "$P" "$Q" >/dev/null
check "14. re-run still emits tag=" "tag=3.0.0" "$(cat "$GITHUB_OUTPUT")"
out=$("$DRAFT" 3.0.0 2>&1); check "14. existing Release (draft or published) left alone" "already exists" "$out"
check "14. gh create not called" "absent" "$([ -f "$GH_LOG" ] && echo called || echo absent)"

# 15. Tag on the wrong commit → no tag= emitted, so no draft step
: > "$GITHUB_OUTPUT"; run "$D" "$E" >/dev/null
check "15. warning case emits nothing (draft step skipped)" "" "$(cat "$GITHUB_OUTPUT")"

# 16. Version with no note → warning, no draft
R=$(commit 3.0.2 "bump, no note for 3.0.1"); : > "$GITHUB_OUTPUT"; : > "$GH_RELEASES"
run "$Q" "$R" >/dev/null
out=$("$DRAFT" 3.0.1 2>&1); check "16. no note → warning, no draft" "No release-notes/3.0.1.md" "$out"
check "16. gh create not called" "absent" "$([ -f "$GH_LOG" ] && echo called || echo absent)"

# 17. No GITHUB_OUTPUT locally → no error
unset GITHUB_OUTPUT; S=$(commit 3.0.3 "bump"); out=$(run "$R" "$S")
check "17. runs locally without GITHUB_OUTPUT" "Tagged 3.0.2" "$out"

echo; echo "$PASS passed, $FAIL failed"; rm -rf "$ROOT"
[ "$FAIL" -eq 0 ]
