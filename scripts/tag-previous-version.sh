#!/usr/bin/env bash
# Tags the version that a push to main just finished.
#
# Every push to main republishes the OTA bundle under the current package.json
# version, so a version keeps shipping until the next bump. When a push changes
# that version, the commit before the first version-changing commit on the
# pushed first-parent range was the last one to ship under the old version, and
# it gets the old version's tag.
#
# Usage: scripts/tag-previous-version.sh <before-sha> <after-sha>
#   DRY_RUN=1 prints the tag instead of creating and pushing it.
#
# In GitHub Actions it writes tag=<version> to $GITHUB_OUTPUT once that tag is
# on the right commit, for draft-release.sh to pick up.
#
# Run by .github/workflows/tag-release.yml; see release-notes/README.md,
# "Shipping a release".
set -euo pipefail
source "$(dirname "$0")/release-note.sh"

BEFORE="${1:?usage: $0 <before-sha> <after-sha>}"
AFTER="${2:?usage: $0 <before-sha> <after-sha>}"

emit_tag() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "tag=$1" >> "$GITHUB_OUTPUT"; fi
}

version_at() {
  git show "$1:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version'
}

if [[ "$BEFORE" =~ ^0+$ ]]; then
  echo "No previous commit (new branch); nothing to tag."
  exit 0
fi

if ! git merge-base --is-ancestor "$BEFORE" "$AFTER"; then
  echo "::warning::$BEFORE is not an ancestor of $AFTER (force push?); not tagging."
  exit 0
fi

OLD="$(version_at "$BEFORE")"
NEW="$(version_at "$AFTER")"

if [ "$OLD" = "$NEW" ]; then
  echo "Version unchanged ($NEW); nothing to tag."
  exit 0
fi

# Old-version commits inside this push shipped too, so walk forward from BEFORE
# until the version changes.
LAST="$BEFORE"
while read -r COMMIT; do
  if [ "$(version_at "$COMMIT")" != "$OLD" ]; then break; fi
  LAST="$COMMIT"
done < <(git rev-list --first-parent --reverse "$BEFORE..$AFTER")

if EXISTING="$(git rev-parse -q --verify "refs/tags/$OLD^{commit}")"; then
  if [ "$EXISTING" = "$(git rev-parse "$LAST")" ]; then
    echo "Tag $OLD already on $LAST; nothing to do."
    # A re-run still drafts the Release if the first run failed before it.
    emit_tag "$OLD"
  else
    # Moving a published tag rewrites history for anyone who fetched it, so a
    # person decides that — see release-notes/README.md.
    echo "::warning::Tag $OLD already exists on $EXISTING, not on $LAST. Left as is; move it by hand if it is wrong."
  fi
  exit 0
fi

TITLE="$(note_title "$LAST" "$OLD")"
MESSAGE="$OLD${TITLE:+ — $TITLE}"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "Would tag $OLD on $LAST: $MESSAGE"
  exit 0
fi

git tag -a "$OLD" "$LAST" -m "$MESSAGE"
if ! git push origin "refs/tags/$OLD"; then
  # GitHub refuses the workflow token a tag on a commit whose workflow files
  # differ from main's — i.e. whenever this push changed a workflow file.
  echo "::error::Could not push tag $OLD. If GitHub mentioned 'workflows' permission, this push changed a workflow file; tag and draft by hand: scripts/tag-previous-version.sh $BEFORE $AFTER && scripts/draft-release.sh $OLD"
  exit 1
fi
echo "Tagged $OLD on $LAST: $MESSAGE"
emit_tag "$OLD"
