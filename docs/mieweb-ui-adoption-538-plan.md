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
12. **🔴 0.8.0 and 0.9.0 regress the clock composer — the version bump is
    reverted.** `RichEditor`, imported from `@mieweb/ui/kerebron` by
    `src/features/huddle/MarkdownEditor.tsx`, reworked its markdown seeding.
    0.7.3 seeds with a plain `loadDocumentText('text/x-markdown', value)`;
    0.8.0 adds `loadingRef` / `valueRef` / `seed` guards **and a
    `.catch(() => void 0)` that silently discards load failures**.

    Effect: after clocking in, the clock composer no longer seeds with the
    existing session post. The editor is genuinely empty — `textContent: ""`,
    `innerHTML: "<p><br class=\"ProseMirror-trailingBreak\"></p>"` — not merely
    hidden. Posting a wrap-up then **replaces the post body, losing the plan
    text**. That is data loss in an ordinary flow.

    Attribution (`tests/e2e/huddle/plan-first-clock-flow.spec.ts`, run per
    commit):

    | Commit               | @mieweb/ui | Result       |
    | -------------------- | ---------- | ------------ |
    | `ui538-baseline`     | 0.7.3      | **8/8 pass** |
    | Phase 1 (bump alone) | 0.8.0      | **2 failed** |
    | Phase 2 (+ config)   | 0.8.0      | 2 failed     |
    | Phase 3 (+ AppModal) | 0.8.0      | 2 failed     |
    | Phase 3              | 0.9.0      | 2 failed     |

    So it is the upgrade, not any change in this branch, and it is not fixed in
    `latest`. **Resolution:** revert the dependency to 0.7.3 and generate the
    agent files with `npx @mieweb/ui@0.8.0 init-agent`, which fetches a
    throwaway copy without installing it — the generated files are static
    markdown, so the setup step still lands. Needs an upstream issue.

13. **Pre-existing, out of scope: `prose-*` classes are dead.**
    `@tailwindcss/typography` is installed but never registered, because
    Tailwind 4 never loaded the legacy `tailwind.config.cjs`. No `prose-`
    selector is emitted in **either** build, so the prose classes in
    `src/features/huddle/MarkdownContent.tsx` have no effect today. Deleting the
    config does not cause this and does not change it. Worth its own issue.

---

## Phases

### Phase 1 — Version bump to ^0.8.0 ⛔ REVERTED (stays on 0.7.3)

Bumped first because `init-agent` ships only in 0.8.0+ (Correction 7), then
reverted once e2e attributed a data-loss regression to the upgrade itself
(Correction 13). The per-phase commit structure is what made that attribution
cheap — the bump was one isolated commit to test against.

- [x] Bump to `^0.8.0` — static checks (lint, typecheck, unit, build) all passed,
      which is precisely why they were not sufficient on their own
- [x] e2e caught what static analysis could not: the `RichEditor` seeding change
- [x] Confirmed 0.9.0 does not fix it
- [x] Reverted to `^0.7.3`
- [x] Agent files kept — generated by `npx @mieweb/ui@0.8.0 init-agent`, which
      needs no install (Phase 2)

**The remaining gap vs. the issue:** the acceptance criterion "installed version
matches the declared range" is met (both 0.7.3), but the implied upgrade is
blocked pending an upstream fix.

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

### Phase 3 — Retire internals-targeting modal CSS ✅ (ThemeProvider ⛔ descoped)

Revised from the issue (see Correction 6). The overrides existed to force a
centered popup on mobile, defeating the library's `min-h-dvh` / `rounded-none` /
`max-h-dvh` defaults.

- [x] New `src/ui/AppModal.tsx` wraps the library `Modal` and applies the same
      three declarations as utilities. Adopted at all 15 call sites (36 tags).
- [x] Org-switcher opts out of the small-screen inset with
      `max-sm:mx-0 max-sm:w-full`, replacing the old
      `:not(.org-switcher-modal)` exclusion.
- [x] Org-switcher bottom-sheet rules keep `.org-switcher-modal` but drop both
      the `[data-slot='modal']` prefix and every `!important`.
- [x] Added `cn` to the `@mieweb/ui` mock in `ReportIssueModal.test.tsx`.

**Verified equivalent, not assumed:** `twMerge` on the library's real base class
string plus AppModal's classes removes `rounded-none`, `min-h-dvh` and
`max-h-dvh`, leaving the centered-popup equivalents. Generated CSS confirms
`max-sm:w-[calc(100%-2rem)]` is emitted after `w-full`, so it wins below 640px,
and `.org-switcher-modal` is emitted after all utilities, so it wins without
`!important`.

**Known remaining coupling:** the org-switcher's open/close animation still keys
off `[data-state]`. It is the only handle `Modal` exposes for its transition,
and the bottom sheet needs a slide rather than the default zoom.

#### ThemeProvider — descoped to a follow-up ⛔

Mounting it would regress behaviour rather than preserve it:

- The library's `useTheme` hardcodes storage key `mieweb-ui-theme` and defaults
  to `system`; the app uses `app:theme` and defaults to `dark`.
- `ThemeProvider` **ignores both props that would reconcile this** —
  `defaultTheme` is destructured to an unused `_defaultTheme` and `storageKey`
  is not destructured at all.
- Both write `data-theme` plus classes to `<html>`, so they would fight, and a
  user with a saved `app:theme` but no `mieweb-ui-theme` would have the provider
  apply the system theme over the app's dark default on mount.

Adopting it therefore means flipping the default from dark to system and
resetting every saved preference — user-visible changes #538 puts out of scope.
Needs its own issue covering the migration of `ThemeToggle`, `SettingsPage`,
`CommandPalette` and `InboxPage` to `useThemeContext`.

**Files:** `src/ui/AppModal.tsx` (new) · `src/styles.css` · 15 `Modal` call sites

### Phase 4 — Hand-rolled modals & overlays ✅

- [x] `InstallerModal.tsx` → `AppModal` + `ModalHeader`/`ModalTitle`/`ModalBody`/
      `ModalFooter`, with `closeOnOverlayClick={false} closeOnEscape={false}` to
      preserve its non-dismissible gate behaviour.
- [x] `UsernameClaimModal.tsx` → same, plus its two stacked actions become a
      vertical `ButtonGroup` (ruleset Rule 2).
- [x] Both drop their hand-rolled `useId` labelling — `ModalTitle` sets the id
      `Modal` already targets with `aria-labelledby`.
- [x] `OtaUpdateGate.tsx` → **narrowed**: `role="progressbar"` → `Progress`;
      the opaque full-screen gate markup stays (Correction 8).

**Deliberate deviation:** the criterion "`OtaUpdateGate` contains no
`fixed inset-0` overlay markup" is **not met**, by choice. See Correction 8.

**`Progress` is used without `label`.** The prop renders _visible_ text above the
bar and switches the accessible name to `aria-labelledby`. Omitting it keeps the
rendered output identical and lets the component name the bar "Progress", which
reads correctly inside a dialog already titled "Updating TimeHuddle". The
existing accessibility test in `OtaUpdateGate.test.tsx` still passes.

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

| Phase                    | Commit     | Validation                                                | Notes                                                 |
| ------------------------ | ---------- | --------------------------------------------------------- | ----------------------------------------------------- |
| baseline                 | `98875e25` | lint ✅ typecheck ✅ format ✅ unit ✅ (149) e2e ✅ (170) | tag `ui538-baseline`                                  |
| 1 — bump 0.8.0           | `889e1a81` | lint ✅ typecheck ✅ format ✅ unit ✅ (149) build ✅     | static checks all passed — e2e later disproved it     |
| 2 — agent setup + config | `177626b4` | lint ✅ typecheck ✅ format ✅ unit ✅ (149) build ✅     | CSS 394,881 → 392,947 bytes (docs no longer scanned)  |
| 3 — AppModal wrapper     | `f8bccd76` | lint ✅ typecheck ✅ format ✅ unit ✅ (149) build ✅     | tw-merge equivalence verified                         |
| e2e after phase 3        | —          | ❌ 2 failed · 5 flaky · 171 passed                        | bisected to the 0.8.0 bump, not to this branch        |
| 1 — **reverted**         | `b3a09d9d` | lint ✅ typecheck ✅ unit ✅ (149) build ✅ plan-first ✅ | back to 0.7.3; composer regression gone (7✅ 1 flaky) |
| 4 — setup modals         | `d0af5fe0` | lint ✅ typecheck ✅ format ✅ unit ✅ (149) build ✅     | OtaUpdateGate narrowed to the Progress swap           |
