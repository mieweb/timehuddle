# Design Audit v2 — `@mieweb/ui` Adoption

**Date:** 2026-09-16
**Branch:** `chore/mvp-remove-messages-and-media-pr` (PR [#542](https://github.com/mieweb/timehuddle/pull/542))
**Base:** `main` @ `4048b82` · **Head:** `e509daa`
**Scope:** `src/` only, excluding `*.test.tsx` / `*.test.ts`
**Predecessor:** v1 audit (2026-09-10), filed as issue [#538](https://github.com/mieweb/timehuddle/issues/538)

> Read-only audit. No code was modified.

---

## 1. Headline Answer

**No. `npx @mieweb/ui init-agent` was never run — not on this branch, and not anywhere in the repository's history.**

A search across all refs (`git log --all --grep`) returns no commit that installs it. Both artifacts the command writes are still absent, so this branch has **no library-maintained UI guidelines and no enforced design language**. The only `@mieweb/ui` guidance in the repo is the hand-written prose block in `.github/copilot-instructions.md`, which is not versioned against the library and does not refresh on upgrade.

Every setup gap identified in v1 is still open. Nothing in this PR addressed them, which is expected — #542 is a feature-removal PR, not the remediation of #538.

---

## 2. Setup Status

### 2.1 `init-agent` artifacts

| Expected artifact | v1 (09-10) | v2 (09-16) | Status |
| --- | --- | --- | --- |
| `.github/instructions/mieweb-ui.instructions.md` | Missing | **Missing** | Directory `.github/instructions/` does not exist |
| `AGENTS.md` (managed block) | Missing | **Missing** | No file at repo root |

`CLAUDE.md` exists but is a **symlink to `.github/copilot-instructions.md`**, not an independent agent ruleset:

```
lrwxr-xr-x  CLAUDE.md -> .github/copilot-instructions.md
```

So all agent guidance in this repo funnels through one hand-maintained file. Tools that read `AGENTS.md` (Cursor, Claude Code, and others following the cross-tool convention) receive nothing.

### 2.2 Remaining setup drift

| Item | Status | Evidence |
| --- | --- | --- |
| **Version drift** | ❌ Worse than it looks | `package.json` declares `^0.7.3`; `package-lock.json` resolves **0.7.3**; `node_modules` actually contains **0.6.1**. The install is stale relative to the lockfile — a plain `npm ci` would change behaviour. Latest published is **0.8.0**. |
| **Tailwind 3 config in a Tailwind 4 build** | ❌ Unchanged | `tailwind.config.cjs` still present, still using the `presets` + `content` (Tailwind 3) pattern while the build runs `@tailwindcss/postcss` with `@source`/`@theme` in `src/styles.css`. |
| **`ThemeProvider` never mounted** | ❌ Unchanged | `grep -rn "ThemeProvider" src` → **0 matches**. Theming is driven manually via `data-theme` on `<html>`; `useThemeContext()` is unavailable app-wide. |
| **CSS overriding library internals** | ❌ Unchanged | 6 occurrences of `data-slot` in `src/styles.css`, using `!important` against `[data-slot='modal']` / `[data-state]`. The file's own comment warns a library rename will break every modal. |
| **Duplicated directives** | ❌ Unchanged | `src/styles.css` lines 224–225 and 227–228 declare `@source ".../@mieweb/ui/dist"` and `@custom-variant dark` twice, verbatim. |
| **No lint guardrail** | ❌ Unchanged | `eslint.config.mjs` contains no `no-restricted-syntax` rule. The "HARD RULE" in the copilot instructions is documentation only — nothing fails CI when raw `<button>` is added. |

**Net: 0 of 8 setup items resolved since v1.**

---

## 3. Adoption Statistics

### 3.1 Overall

| Metric | Count |
| --- | --- |
| Non-test `.tsx` files in `src/` | **87** |
| Files importing `@mieweb/ui` | **61 (70.1%)** |
| Files with **zero** `@mieweb/ui` import | **26 (29.9%)** |
| Files containing raw interactive elements | **31 (35.6%)** |

### 3.2 Raw element inventory

| Raw element | Occurrences | Files affected |
| --- | --- | --- |
| `<button>` | **76** | 30 |
| `<input>` (excluding hidden `type="file"`) | **5** | 5 |
| `<textarea>` | **2** | 2 |
| `<select>` | 0 | 0 |
| Hand-rolled `fixed inset-0` overlay | **9** | 8 |
| Hand-rolled `animate-spin` spinner | — | 5 |
| **Total raw interactive elements** | **83** | **31** |

Hidden `<input type="file">` (9 occurrences across 7 files) is excluded throughout — those are never rendered and are an accepted exception.

### 3.3 Movement since v1

| Metric | v1 (09-10) | v2 (09-16) | Δ |
| --- | --- | --- | --- |
| Raw `<button>` occurrences | ~76 | **76** | **0** |
| Setup items resolved | 0 / 8 | 0 / 8 | **0** |
| Files with zero library import | — | 26 | — |

Two v1 offenders (`MessagesPage.tsx`, `MediaPage.tsx`) are gone from this branch — **deleted by this PR, not migrated**. That removes their violations from the count but represents no improvement in adoption discipline. The raw-button total held flat at 76 because new code added elsewhere offset the deletions.

---

## 4. Files Still Using Raw HTML

Verified by direct grep. `Lib?` = whether the file imports `@mieweb/ui` at all.

### 4.1 Tier A — No library import at all (12 files)

These files have zero `@mieweb/ui` presence and build their entire UI from raw markup.

| File | Buttons | Inputs | Textarea | Primary gap |
| --- | --- | --- | --- | --- |
| [src/ui/BottomNav.tsx](../src/ui/BottomNav.tsx) | 9 | — | — | `Button`, `Sheet` |
| [src/features/huddle/PostCard/index.tsx](../src/features/huddle/PostCard/index.tsx) | 8 | — | — | `Button`, `Dropdown`, `Avatar` — see note |
| [src/ui/Sidebar.tsx](../src/ui/Sidebar.tsx) | 3 | — | — | `Button` |
| [src/ui/LandingPage.tsx](../src/ui/LandingPage.tsx) | 3 | — | — | `Modal`, `Button`, `Card` |
| [src/features/huddle/ComposerAttachments.tsx](../src/features/huddle/ComposerAttachments.tsx) | 3 | — | — | `Badge`, `Button` |
| [src/features/huddle/HuddleComments/index.tsx](../src/features/huddle/HuddleComments/index.tsx) | 2 | — | 1 | `Avatar`, `Textarea`, `Button` |
| [src/features/huddle/MentionMenu.tsx](../src/features/huddle/MentionMenu.tsx) | 2 | 1 | — | `Button`, `Input`, `Avatar` |
| [src/features/huddle/TicketPicker.tsx](../src/features/huddle/TicketPicker.tsx) | 2 | 1 | — | `Button`, `Input`, `Badge` |
| [src/features/huddle/PulseAttachButton.tsx](../src/features/huddle/PulseAttachButton.tsx) | 2 | — | — | `Button` |
| [src/features/org/OrganizationChart.tsx](../src/features/org/OrganizationChart.tsx) | 2 | — | — | `Button` (chart itself is an accepted exception) |
| [src/features/profile/UsernameBadge.tsx](../src/features/profile/UsernameBadge.tsx) | 1 | — | — | `Button` |
| [src/features/profile/WorkSummaryTags.tsx](../src/features/profile/WorkSummaryTags.tsx) | 1 | — | — | `Button` |
| [src/features/huddle/AttachmentBar.tsx](../src/features/huddle/AttachmentBar.tsx) | 1 | — | — | `Button`, `Spinner` |

> **Note on `PostCard/index.tsx`:** it does import `Badge` from `@mieweb/ui` (line 2), so it is technically Tier B. It is listed here because 8 raw buttons plus a hand-rolled avatar make it functionally unmigrated.

### 4.2 Tier B — Imports the library but still hand-rolls (18 files)

These are the more insidious cases: the file demonstrably knows about `@mieweb/ui` and uses it in places, then drops to raw markup elsewhere.

| File | Buttons | Inputs | Textarea | Notes |
| --- | --- | --- | --- | --- |
| [src/features/dashboard/DashboardPage.tsx](../src/features/dashboard/DashboardPage.tsx) | **8** | — | — | Lines 345, 357, 411, 423 are tab/view toggles → `Tabs` or `Toggle`. Lines 732, 799, 865, 936 are clickable list rows → `Button variant="ghost"`. |
| [src/features/tickets/TicketsPage.tsx](../src/features/tickets/TicketsPage.tsx) | **5** | 1 | — | Lines 265, 329, 591, 1321, 1334 |
| [src/features/tickets/TicketDetailPage.tsx](../src/features/tickets/TicketDetailPage.tsx) | 4 | 1 | — | Includes a "Back to tickets" pill |
| [src/ui/OrgTeamSwitcher.tsx](../src/ui/OrgTeamSwitcher.tsx) | 3 | — | — | Uses `Modal`/`Select`/`Badge`; trigger + team rows + "New team" stay raw |
| [src/features/huddle/HuddleComposer.tsx](../src/features/huddle/HuddleComposer.tsx) | 2 | — | — | |
| [src/features/teams/TeamsPage.tsx](../src/features/teams/TeamsPage.tsx) | 2 | — | — | Otherwise the strongest file in the codebase |
| [src/features/timers/WorkPage.tsx](../src/features/timers/WorkPage.tsx) | 2 | — | — | Lines 787, 978 |
| [src/features/feedback/ReportIssueModal.tsx](../src/features/feedback/ReportIssueModal.tsx) | 2 | — | — | `Modal` correct; the two option rows inside are raw |
| [src/pages/Huddle.tsx](../src/pages/Huddle.tsx) | 2 | — | — | |
| [src/features/clock/ClockPage.tsx](../src/features/clock/ClockPage.tsx) | 1 | — | — | Line 428 |
| [src/features/inbox/InboxPage.tsx](../src/features/inbox/InboxPage.tsx) | 1 | — | — | |
| [src/features/notifications/NotificationsPage.tsx](../src/features/notifications/NotificationsPage.tsx) | 1 | — | — | |
| [src/features/profile/ProfilePage.tsx](../src/features/profile/ProfilePage.tsx) | 1 | — | — | |
| [src/features/seeder/SeederPage.tsx](../src/features/seeder/SeederPage.tsx) | 1 | — | — | Preset selector cards |
| [src/features/timers/TodayStatusCard.tsx](../src/features/timers/TodayStatusCard.tsx) | 1 | — | — | "Working on" ticket link |
| [src/ui/UserDropdown.tsx](../src/ui/UserDropdown.tsx) | 1 | — | — | Dropdown trigger — borderline acceptable |
| [src/features/profile/ProfileFeed.tsx](../src/features/profile/ProfileFeed.tsx) | — | 1 | — | |
| [src/features/huddle/MarkdownEditor.tsx](../src/features/huddle/MarkdownEditor.tsx) | — | — | 1 | Kerebron wrapper — likely acceptable |

### 4.3 Hand-rolled modals and overlays (9 instances, 8 files)

| File | Line | Markup | Should be |
| --- | --- | --- | --- |
| [src/ui/InstallerModal.tsx](../src/ui/InstallerModal.tsx) | 38 | `fixed inset-0 z-50 … bg-black/60 backdrop-blur-sm` | `Modal` |
| [src/ui/UsernameClaimModal.tsx](../src/ui/UsernameClaimModal.tsx) | 124 | Identical pattern, copy-pasted | `Modal` |
| [src/ui/OtaUpdateGate.tsx](../src/ui/OtaUpdateGate.tsx) | 81 | `fixed inset-0 z-[2147483647]` | `AlertDialog` |
| [src/ui/BottomNav.tsx](../src/ui/BottomNav.tsx) | 297 | `fixed inset-0 z-50` + `role="dialog" aria-modal` | `Sheet` |
| [src/ui/LandingPage.tsx](../src/ui/LandingPage.tsx) | 595 | `fixed inset-0 z-[100] … bg-black/80` lightbox | `Modal` |
| [src/ui/ViewportOverlay.tsx](../src/ui/ViewportOverlay.tsx) | 54 | `fixed inset-0 z-50` | `Modal` |
| [src/ui/AppLayout.tsx](../src/ui/AppLayout.tsx) | 417 | Mobile drawer scrim | Accepted — drawer backdrop |
| [src/ui/CommandPalette.tsx](../src/ui/CommandPalette.tsx) | 286, 292, 295 | `cmdk` `Command.Dialog` wrapper | Accepted — third-party |

Three of these (`InstallerModal`, `UsernameClaimModal`, `OtaUpdateGate`) are the **same violations flagged in v1 and still untouched**.

### 4.4 Hand-rolled progress and spinners

| File | Line | Markup | Should be |
| --- | --- | --- | --- |
| [src/ui/OtaUpdateGate.tsx](../src/ui/OtaUpdateGate.tsx) | ~108 | `<div role="progressbar">` + inline width | `Progress` |
| [src/features/pulse-upload/PulseUploadButton.tsx](../src/features/pulse-upload/PulseUploadButton.tsx) | 253, 261 | `role="progressbar"` + `style={{ width: \`${progress}%\` }}` | `Progress` |
| [src/features/huddle/AttachmentBar.tsx](../src/features/huddle/AttachmentBar.tsx) | ~33 | inline `<svg className="animate-spin">` | `Spinner` |
| `CommandPalette.tsx`, `Timer.tsx`, `WorkPage.tsx`, `Huddle.tsx` | — | `animate-spin` usages | Review case-by-case |

---

## 5. What This PR Tells Us About New Code

`#542` adds `src/features/pulse-upload/` and a one-click dev sign-in. This is the most useful signal in the audit, because it shows what happens **without** installed guidelines:

| New file | Library usage | Verdict |
| --- | --- | --- |
| [src/features/pulse-upload/PulseUploadModal.tsx](../src/features/pulse-upload/PulseUploadModal.tsx) | `Modal`, `ModalHeader`, `ModalTitle`, `ModalBody`, `ModalFooter`, `Button`, `Text` | ✅ **Gold standard.** Zero raw elements. Use as the reference pattern. |
| [src/features/pulse-upload/PulseUploadButton.tsx](../src/features/pulse-upload/PulseUploadButton.tsx) | `Button` et al., but hand-rolls the progress bar (lines 253–261) | ⚠️ Partial |
| [src/features/huddle/PulseAttachButton.tsx](../src/features/huddle/PulseAttachButton.tsx) | **None**, 2 raw `<button>` | ❌ Not migrated |
| [src/ui/LoginForm.tsx](../src/ui/LoginForm.tsx) (dev sign-in) | `Input`, `Button`, `Select`, `Text` | ✅ Compliant |

Three of four new/touched surfaces get it right. But `PulseAttachButton.tsx` was authored on this branch with **no library import at all**, sitting directly beside a file that models the correct pattern. Adoption is currently a function of which file the author happened to look at — which is precisely the gap `init-agent` closes.

---

## 6. Accepted Exceptions

No action required on these:

- [src/ui/CommandPalette.tsx](../src/ui/CommandPalette.tsx) — `cmdk` is the right tool for a command palette.
- [src/ui/AnchoredMenu.tsx](../src/ui/AnchoredMenu.tsx) — positioning utility, not a visual component.
- [src/ui/Timer.tsx](../src/ui/Timer.tsx) — deliberate compound component (`TimerRoot` / `TimerIcon` / `TimerDisplay`).
- [src/features/org/OrganizationChart.tsx](../src/features/org/OrganizationChart.tsx) — `@mieweb/ychart` wrapper (its 2 raw buttons are still fixable).
- [src/ui/AppLayout.tsx](../src/ui/AppLayout.tsx) line 417 — mobile drawer scrim.
- Hidden `<input type="file">` — 9 occurrences, never rendered.
- `<div>` / `<span>` used purely as flex/grid layout glue.

### Fully compliant files

`AppHeader.tsx`, `GitHubConnectionRow.tsx`, `ThemeToggle.tsx`, `TimerToggleButton.tsx`, `ClockInHeaderTimer.tsx`, `PulseUploadModal.tsx`, `TimesheetJustificationFields.tsx`.

---

## 7. Prioritized Remediation

1. **Run `npx @mieweb/ui init-agent` and commit both artifacts.** Everything below regresses without it. Cheapest, highest-leverage action available.
2. **Fix the install/lockfile mismatch** — `node_modules` has 0.6.1 while the lockfile says 0.7.3. Run a clean `npm ci` and decide whether to move to `^0.8.0`.
3. **Add the ESLint `no-restricted-syntax` guardrail** for raw `<button>` / `<input>` / `<select>` / `<textarea>` under `src/`, with an allowlist for the §6 exceptions. Without it, the 76 raw buttons will be 80 next month.
4. **Migrate the three repeat-offender modals** — `InstallerModal`, `UsernameClaimModal`, `OtaUpdateGate` → `Modal` / `AlertDialog` + `Progress`. Flagged in v1, untouched since. Best accessibility return per line changed.
5. **`DashboardPage.tsx` (8 raw buttons)** — the largest Tier B offender, and a primary screen. Tabs → `Tabs`, rows → `Button variant="ghost"`.
6. **`BottomNav.tsx` (9 raw buttons + hand-rolled dialog)** — the largest Tier A offender, on every mobile screen.
7. **`PostCard/index.tsx` (8 raw buttons + hand-rolled avatar)** — highest-traffic surface in the app.
8. **De-duplicate the copy-pasted `Avatar()` helper** in `PostCard/index.tsx` and `HuddleComments/index.tsx` → `Avatar`. A DRY violation on top of the component rule.
9. **Huddle composer cluster** — `ComposerAttachments`, `TicketPicker`, `MentionMenu`, `AttachmentBar`, `PulseAttachButton` → `Badge`, `Button`, `Input`, `Spinner`.
10. **Mount `ThemeProvider`** and retire the `[data-slot='modal']` `!important` overrides in `src/styles.css`; dedupe the repeated `@source` / `@custom-variant` lines; delete or migrate `tailwind.config.cjs`.
11. **Long tail** — the 1–2 button Tier B files (`UsernameBadge`, `WorkSummaryTags`, `TodayStatusCard`, `TicketDetailPage` back-link, `ReportIssueModal` options, `InboxPage`, `SeederPage`). Good first issues.

---

## 8. Method

All figures were produced by direct static inspection of the working tree at `e509daa`:

- File counts: `find src -name '*.tsx' ! -name '*.test.tsx'`
- Adoption: `grep -rl "@mieweb/ui" src --include='*.tsx'`
- Raw elements: per-file `grep -c` for `<button`, `<input`, `<textarea`, `<select`, with `type="file"` subtracted from input totals
- Overlays: `grep -rn "fixed inset-0"`
- Setup artifacts: filesystem checks plus `git log --all --grep`

Line numbers are accurate as of `e509daa` and will drift as the branch moves. Tests were excluded throughout.
