# @mieweb/ui Adoption — Issue #538 Working Plan

Tracking doc for [#538](https://github.com/mieweb/timehuddle/issues/538).
Branch: `feat/mieweb-ui-adoption-538` · Baseline tag: `ui538-baseline` (`98875e25`)

**Status legend:** ⬜ not started · 🟡 in progress · ✅ done · ⛔ descoped

---

## Fallback strategy

The migration touches global CSS, the app root, and ~15 components, so every phase
is independently revertable:

- **One commit per phase.** Never amended, so `git revert <sha>` backs out exactly
  one phase without disturbing the others.
- **`ui538-baseline` tag** marks the last known-good commit before any change.
  `git reset --hard ui538-baseline` returns the branch to a clean pre-work state.
- **Validation gate per phase:** `lint` + `typecheck` + `format` + `test:unit` must
  be green before the phase is committed. The full Playwright e2e suite (~20 min,
  needs `timehuddle-meteor-test` on :3101) runs at the baseline and again after the
  risky UI phases.
- **The version bump goes first and alone** (see Correction 7 — `init-agent` only
  exists in 0.8.0+, so nothing else can proceed without it). It is committed by
  itself and validated against the full suite before any component work lands on
  top, so `git revert` on that one commit cleanly undoes the upgrade.

### Pre-work baseline (verified 2026-09-17)

| Check               | Result                                              |
| ------------------- | --------------------------------------------------- |
| `npm run lint`      | ✅ clean                                            |
| `npm run typecheck` | ✅ clean                                            |
| `npm run format`    | ✅ clean                                            |
| `npm run test:unit` | ✅ 149 passed / 16 files                            |
| `npm run test:e2e`  | ✅ 170 passed · 8 flaky · 4 skipped (19.6m, exit 0) |

**Pre-existing flaky specs (passed on retry at baseline — do not misattribute):**

- `huddle/composer-responsive.spec.ts:63` — composer controls at 390×844
- `huddle/plan-first-clock-flow.spec.ts:142,174`
- `huddle/yjs-collab-editing.spec.ts:181`
- `organizations/member-blocking-full-flow.spec.ts:20`
- `teams/profile-routing.spec.ts:75,107`
- `teams/teams.spec.ts:90`

The composer and teams specs overlap the Huddle and nav work in Phases 5–7, so a
failure there must be checked against this list before being treated as a regression.

---

## Corrections to the issue as written

The issue's audit predates PR #542 and the 0.7.3 install. Verified against the
working tree on 2026-09-17:

1. **Version drift is already resolved.** The issue reports `^0.7.3` declared but
   `0.6.1` installed. Both now resolve to **0.7.3**. No drift remains.
2. **Latest published is 0.9.0, not 0.8.0.** The issue predates two releases.
   Bump target is `^0.8.0` per decision; 0.9.0 noted as a follow-up.
3. **Every component the migration needs already exists in 0.7.3** — `Modal`,
   `Sheet`, `AlertDialog`, `Progress`, `Dropdown`, `Textarea`, `Avatar`, `Badge`,
   `Spinner`, `ThemeProvider`. The bump is therefore needed for the **tooling**
   (Correction 7), not for any component swap.
4. **`MediaPage.tsx` and `MessagesPage.tsx` no longer exist** (deleted in #542).
   Their line items are dropped from scope.
5. **`Modal` already has a `size` prop** (`sm`…`4xl`, `full`). The issue's proposal
   to "open an upstream request for the Modal size/variant prop" is stale — the
   `TODO` in `src/styles.css:147` is already satisfied upstream.
6. **…but `size` does not replace the CSS overrides.** See Phase 2 — the overrides
   defeat the library's _full-screen-on-mobile_ default, which `size` (a
   `sm:max-w-*` variant) cannot express. Removing them naively is a **visual
   change on mobile**, which #538 puts out of scope. Revised approach in Phase 2.
7. **`init-agent` does not exist in 0.7.3 — it ships in 0.8.0+.** The installed
   package has no `bin` entry at all; 0.8.0 and 0.9.0 both expose
   `mieweb-ui` → `agent/init-agent.mjs`. So `npx @mieweb/ui init-agent` cannot
   work today. **The version bump is a hard prerequisite for the agent setup**,
   which reverses the original sequencing — the bump is now Phase 1.
8. **`AlertDialog` is a poor fit for `OtaUpdateGate`.** It is a confirm/cancel
   dialog built on `Modal` (centered card, translucent overlay, action buttons,
   `actionLabel` defaulting to "Continue"). The OTA gate is a deliberate
   _opaque full-screen takeover_ (`bg-white dark:bg-neutral-950`,
   `z-[2147483647]`) with no response expected during download. Swapping it
   would be a visible UX change and would add a stray action button. See Phase 4
   for the narrowed proposal.
9. **The two `Avatar()` functions are near-duplicates, not identical.** The issue
   calls them "identical". `PostCard`'s takes `initials` + `color`;
   `HuddleComments`' additionally supports `avatarUrl` via an `<img>` with an
   `onError` initials fallback. The library `Avatar` covers both (`src` + `name`)
   but exposes **no colour variant** — only `size` and `ring`. The per-user
   colour map must be passed through `className` or every user loses their
   avatar colour (a visual regression).
10. **`BottomNav`'s sheet is the riskiest swap.** It is animated with
    framer-motion (`AnimatePresence` + a spring transition) and handles
    `pb-[env(safe-area-inset-bottom)]`. This is a Capacitor app, so the
    safe-area padding is load-bearing on iOS and must be preserved on the
    `Sheet` replacement.
11. **The generated markdown leaks utility CSS into the production bundle.**
    Tailwind 4 auto-detects `**/*.md` and compiles any class-like token out of a
    fenced example. Adding `AGENTS.md` + the generated ruleset grew the CSS by
    33 bytes; repo markdown as a whole contributed ~1.7 KB. Fixed with
    `@source not "../**/*.md"` in `src/styles.css`. Verified safe: the exclusion
    drops exactly 17 selectors, none of which appear in `src/` (`bg-black/5`,
    `text-gray-800` and `border-indigo-300` look used but are substring matches
    for `bg-black/50`, `prose-p:text-gray-800` and
    `prose-blockquote:border-indigo-300` — different selectors).
12. **Pre-existing, out of scope: `prose-*` classes are dead.**
    `@tailwindcss/typography` is installed but never registered, because
    Tailwind 4 never loaded the legacy `tailwind.config.cjs`. No `prose-`
    selector is emitted in **either** build, so the prose classes in
    `src/features/huddle/MarkdownContent.tsx` have no effect today. Deleting the
    config does not cause this and does not change it. Worth its own issue.

---

## Phases

### Phase 1 — Version bump to ^0.8.0 (prerequisite) ✅

Moved to the front: `init-agent` ships only in 0.8.0+ (Correction 7). Committed on
its own so the upgrade is a single revertable change.

- [x] Bump `@mieweb/ui` → `^0.8.0`, reinstall, confirm lockfile resolves 0.8.0
- [x] Review the 0.7.3 → 0.8.0 diff for breaking changes to the components in use —
      none found; lint, typecheck, unit tests and a production build all pass
- [x] Full `lint` / `typecheck` / `format` / `test:unit` before committing
- [x] Note 0.9.0 (current `latest`) as a follow-up

Nested `@mieweb/ui` copies remain under `@mieweb/datavis` (0.7.3) and
`@mieweb/ychart` (0.2.4). Those are each package's own pinned dependency, not app
resolution — the app imports resolve to the top-level 0.8.0.

**Files:** `package.json` · `package-lock.json`

### Phase 2 — Agent setup + build-config drift ✅

- [x] `npx mieweb-ui init-agent` → committed `.github/instructions/mieweb-ui.instructions.md` + `AGENTS.md`
- [x] Trim duplicated `@mieweb/ui` prose from `.github/copilot-instructions.md` — replaced with a pointer, so the library file is the single source of truth
- [x] Delete `tailwind.config.cjs` — **proven inert**: no `@config` directive exists, nothing references the file, and a build before/after produced a byte-identical CSS bundle (same content hash)
- [x] De-duplicate `@source` + `@custom-variant dark` in `src/styles.css`
- [x] Document the "rerun `init-agent` after every upgrade" rule (in the copilot-instructions pointer)
- [x] **Added:** `@source not "../**/*.md"` — see Correction 11

#### Rules the generated ruleset adds that the repo's prose did not

The library file is stricter than the old hand-written section. Two rules change
how the later phases should be written:

- **Rule 2 — adjacent buttons must be wrapped in `ButtonGroup`**, and icon-only
  buttons need `size="icon"` + a required `aria-label`. This applies directly to
  `BottomNav` (Phase 6) and the `PostCard` action row (Phase 7).
- **Rule 5 — use variants/sizes, never `className` hacks that imitate a variant.**
  Noted because Phase 3's modal-sizing approach leans on `className`; that is
  acceptable only where no prop expresses the behaviour (the mobile full-screen
  default), and `size` should be preferred wherever it maps.

**Files:** `package.json` · `tailwind.config.cjs` (del) · `src/styles.css` · `.github/copilot-instructions.md` · `AGENTS.md` (new) · `.github/instructions/mieweb-ui.instructions.md` (new)

### Phase 3 — ThemeProvider + retire internals-targeting CSS ⬜

Revised from the issue (see Correction 6). The overrides at `src/styles.css:148-202`
exist to force a centered popup on mobile, defeating the library's
`min-h-dvh` / `rounded-none` / `max-h-dvh` defaults. Plan that preserves rendered
output **and** removes the `[data-slot='modal']` coupling:

- [ ] Pass the equivalent Tailwind utilities via each `Modal`'s `className`
      (`min-h-0 rounded-xl max-h-[calc(100dvh-2rem)]`). `tw-merge` resolves these
      against the library's base classes, so no `!important` and no internals
      selector is needed.
- [ ] Keep the org-switcher bottom-sheet rules but drop the `[data-slot='modal']`
      specificity prefix — `.org-switcher-modal` is already a repo-owned class.
- [ ] Mount `ThemeProvider` at the app root, wired to the existing `data-theme`
      toggle so current dark-mode behaviour is preserved exactly.

**Files:** `src/main.tsx` or `src/ui/AppLayout.tsx` · `src/styles.css` · each `Modal` call site

### Phase 4 — Hand-rolled modals & overlays ⬜

- [ ] `InstallerModal.tsx` → `Modal` / `ModalHeader` / `ModalBody`. It is a
      non-dismissible gate with no open state, so it needs
      `open closeOnOverlayClick={false} closeOnEscape={false}` to keep behaviour.
- [ ] `UsernameClaimModal.tsx` → same (also non-dismissible)
- [ ] `OtaUpdateGate.tsx` → **narrowed**: swap the hand-rolled
      `role="progressbar"` for `Progress`, but keep the opaque full-screen gate
      markup (Correction 8). Needs a call on the acceptance criterion.

**Files:** `src/ui/InstallerModal.tsx` · `src/ui/UsernameClaimModal.tsx` · `src/ui/OtaUpdateGate.tsx`

### Phase 5 — Huddle avatars, dropdown, textarea ⬜

- [ ] Delete the duplicated local `Avatar()` from `PostCard/index.tsx` **and** `HuddleComments/index.tsx` → `Avatar`
- [ ] `PostCard` dropdown → `Dropdown` / `DropdownItem`
- [ ] `HuddleComments` raw `<textarea>` → `Textarea`
- [ ] `MentionMenu.tsx` initials circle → `Avatar`

**Files:** `src/features/huddle/PostCard/index.tsx` · `src/features/huddle/HuddleComments/index.tsx` · `src/features/huddle/MentionMenu.tsx`

### Phase 6 — BottomNav refactor ⬜

- [ ] `role="dialog"` "More" sheet → `Sheet` (`side="bottom"`)
- [ ] 9 raw `<button>` → `Button`

**Files:** `src/ui/BottomNav.tsx`

### Phase 7 — Remaining medium-severity swaps ⬜

- [ ] `PostCard` remaining raw buttons → `Button`
- [ ] `Sidebar.tsx` `NavLink` → `Button variant="ghost"`
- [ ] `OrgTeamSwitcher.tsx` → `Button`
- [ ] `TicketPicker.tsx` / `MentionMenu.tsx` → `Button`, `Input`, `Badge`
- [ ] `ComposerAttachments.tsx` chips → `Badge`
- [ ] `AttachmentBar.tsx` spinner SVG → `Spinner`
- [ ] `SeederPage.tsx` → `Button`, `Card`
- [ ] `ReportIssueModal.tsx` option rows → `Button`
- [ ] `InboxPage.tsx` `MailCard` → `Card` / `CardContent`
- [ ] `LandingPage.tsx` cards → `Card`
- [ ] ~~`MediaPage.tsx`~~ ⛔ file deleted in #542

### Phase 8 — ESLint guardrail ⬜

Added last, on already-migrated code, so it lands green with a minimal allowlist.

- [ ] `no-restricted-syntax` blocking raw `<button>` / `<input>` / `<select>` / `<textarea>` under `src/`
- [ ] Allowlist: `CommandPalette.tsx`, `AnchoredMenu.tsx`, `Timer.tsx`, hidden file input in `AttachmentBar.tsx`

**Files:** `eslint.config.mjs`

---

## Phase log

| Phase                    | Commit     | Validation                                                | Notes                                                |
| ------------------------ | ---------- | --------------------------------------------------------- | ---------------------------------------------------- |
| baseline                 | `98875e25` | lint ✅ typecheck ✅ format ✅ unit ✅ (149) e2e ✅ (170) | tag `ui538-baseline`                                 |
| 1 — bump 0.8.0           | `889e1a81` | lint ✅ typecheck ✅ format ✅ unit ✅ (149) build ✅     | no breaking changes found                            |
| 2 — agent setup + config | pending    | lint ✅ typecheck ✅ format ✅ unit ✅ (149) build ✅     | CSS 394,881 → 392,947 bytes (docs no longer scanned) |
