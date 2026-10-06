# Helpers for reading release-notes/<version>.md as it was at a given commit.
# Sourced by tag-previous-version.sh and draft-release.sh; not run directly.
# The note format is in release-notes/README.md.

# note_title <commit> <version> — the frontmatter title, or nothing.
note_title() {
  git show "$1:release-notes/$2.md" 2>/dev/null | sed -n 's/^title: //p' | head -n 1 || true
}

# note_body <commit> <version> <asset-base-url> — everything below the
# frontmatter, with assets/… paths pointed at <asset-base-url>/assets/… so
# images still load outside the app.
note_body() {
  git show "$1:release-notes/$2.md" \
    | awk 'fm < 2 { if ($0 == "---") fm++; next } { print }' \
    | sed '/./,$!d' \
    | sed "s#](assets/#]($3/assets/#g"
}
