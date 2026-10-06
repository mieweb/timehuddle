#!/usr/bin/env bash
# Drafts the GitHub Release for a tagged version from its in-app note.
#
# Title is the note's title:, body is the note below its frontmatter, read at
# the tagged commit. Image paths point at that commit on raw.githubusercontent
# (the repo is public), so they load on GitHub and never change. The Release is
# a draft: nobody is notified until a person reviews it and clicks Publish.
#
# Usage: scripts/draft-release.sh <version>
#   DRY_RUN=1 prints the title and body instead of creating the draft.
#   Needs gh authenticated (GH_TOKEN in Actions).
#
# Run by .github/workflows/tag-release.yml after tag-previous-version.sh; see
# release-notes/README.md, "Shipping a release".
set -euo pipefail
source "$(dirname "$0")/release-note.sh"

TAG="${1:?usage: $0 <version>}"
REPO="${GITHUB_REPOSITORY:-mieweb/timehuddle}"

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "::error::Tag $TAG does not exist."
  exit 1
fi

if ! git cat-file -e "$TAG:release-notes/$TAG.md" 2>/dev/null; then
  echo "::warning::No release-notes/$TAG.md at tag $TAG; no Release drafted. Write one by hand."
  exit 0
fi

TITLE="$(note_title "$TAG" "$TAG")"
BODY="$(note_body "$TAG" "$TAG" "https://raw.githubusercontent.com/$REPO/$TAG/release-notes")"

if [ "${DRY_RUN:-}" = "1" ]; then
  printf 'Would draft Release %s\nTitle: %s\n\n%s\n' "$TAG" "${TITLE:-$TAG}" "$BODY"
  exit 0
fi

# Drafts have no tag yet as far as the API is concerned, so look in the list
# rather than asking for the tag's Release directly.
if gh release list --repo "$REPO" --limit 100 --json tagName -q '.[].tagName' | grep -qxF "$TAG"; then
  echo "A Release for $TAG already exists (draft or published); left as is."
  exit 0
fi

printf '%s\n' "$BODY" | gh release create "$TAG" --repo "$REPO" --verify-tag --draft \
  --title "${TITLE:-$TAG}" --notes-file -
echo "Drafted Release $TAG — review and publish it at https://github.com/$REPO/releases"
