# Archived: vendored `@mieweb/ui` tarball setup

Moved here when `@mieweb/ui` switched from a locally-built, committed tarball
(`file:vendor/mieweb-ui.tgz`) to the published npm package (`^0.7.3`). See
PR #518 / issue #517 for the full history.

## Why this existed

Two problems required vendoring the library from source instead of using the
npm registry:

1. **Unreleased components.** `vendor/ui`'s `main` branch had components
   (`Sparkline`, `KeyboardShortcutsOverlay`) that weren't on npm yet.
2. **Type duplication.** Linking `file:vendor/ui` directly (without an
   npm/pnpm workspace) gave the submodule its own separate `node_modules`,
   so TypeScript saw two incompatible copies of `@types/react` and every
   `@mieweb/ui` component's props collapsed to `any`.

`build-ui-tarball.mjs` worked around both: it rebuilt `vendor/ui` and
`npm pack`ed it into `vendor/mieweb-ui.tgz`, which installs cleanly into the
app's single shared `node_modules` like any other npm dependency — no
workspace needed, no duplicate types.

## Why it was removed

At the time of removal, the app didn't import either unreleased component,
so the plain npm package covered every `@mieweb/ui` component actually in
use. Carrying a submodule + a 4MB committed binary + two build scripts for
components nothing used wasn't worth the maintenance cost.

## Contents

- `mieweb-ui.tgz` — the last built tarball (from `vendor/ui` @ `fd22cb1b`,
  mieweb/ui `main`)
- `.ui-tarball-commit` — marker file recording which `vendor/ui` commit it
  was built from
- `build-ui-tarball.mjs` — the rebuild-and-repack automation script
- `ensure-ui-build.mjs` — older pre-tarball postinstall script (already
  unreferenced before this archive; kept only for historical context)

The `vendor/ui` submodule itself isn't archived here (it's an external repo,
not something to duplicate) — it was pinned to commit `fd22cb1b` on
`https://github.com/mieweb/ui` (`main` branch) at the time of removal.

## How to restore vendoring

If a future feature needs an `@mieweb/ui` component not yet published to
npm:

1. Re-add the submodule: `git submodule add https://github.com/mieweb/ui vendor/ui`
2. Restore the scripts: `cp .attic/mieweb-ui-tarball/build-ui-tarball.mjs scripts/`
3. Add back to `package.json`:
   - `"setup:ui": "node scripts/build-ui-tarball.mjs"` under `scripts`
   - `"@mieweb/ui": "file:vendor/mieweb-ui.tgz"` under `dependencies`
4. Run `npm run setup:ui` to rebuild the tarball from the current `vendor/ui` commit.
5. Restore the `Dockerfile` `COPY vendor/mieweb-ui.tgz` steps (see PR #518's
   diff for the exact lines removed) so the tarball is present before `npm install`.
6. Confirm the `vendor/ui` commit you pin is pushed to the public
   `mieweb/ui` repo — an unpushed/local-branch commit breaks CI submodule
   checkout (this is what originally forced the tarball approach; see #517).
