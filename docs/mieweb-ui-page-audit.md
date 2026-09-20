# @mieweb/ui Page-by-Page Adoption Audit

**Status:** In progress — pages are audited one at a time, by URL, on request.
**Library version:** `@mieweb/ui@0.7.3` (pinned; see [CLAUDE.md](../CLAUDE.md) for why 0.8.0+ is blocked)
**Rules of record:** [`.github/instructions/mieweb-ui.instructions.md`](../.github/instructions/mieweb-ui.instructions.md)
**Started:** 2026-09-20

---

## 1. Purpose

Measure, per page, how much of the UI is actually built from `@mieweb/ui` versus hand-rolled
markup — and record what is missing from the library so the gaps can be fed back upstream.

Each audited page answers three questions:

1. **How much is library?** — which `@mieweb/ui` components the page renders, and what share
   of its interactive/structural surface they cover.
2. **What is custom?** — hand-rolled markup, local components, `className` restyling, raw
   HTML controls.
3. **Why is it custom?** — a library gap (no component exists), a library defect (component
   exists but is broken at 0.7.3), or just unfinished adoption work.

The third question is the important one. A page at 60% is fine if the other 40% is a genuine
library gap; a page at 60% because nobody migrated it is a backlog item.

---

## 2. Method

For each page:

```
URL  →  route entry in src/ui/AppLayout.tsx  →  page component  →  its component tree
```

1. Resolve the URL to its page component through the `ROUTES` registry in
   [AppLayout.tsx:65-85](../src/ui/AppLayout.tsx#L65-L85).
2. Walk the page's own components (not the shared shell — the shell is audited once, below).
3. Inventory every `@mieweb/ui` import and where it renders.
4. Inventory every custom element: local components, raw HTML that duplicates a library
   component, `className` overrides on library components, hardcoded colors.
5. Classify each custom item as **Gap** / **Defect** / **Backlog**.
6. Score and record in the results table.

### Scoring rubric

The headline number is **component coverage**: of the page's distinct UI "slots" that the
library has a component for, how many use it.

| Grade | Coverage | Meaning                                                        |
| ----- | -------- | -------------------------------------------------------------- |
| **A** | ≥ 90%    | Essentially all library; any custom markup is a documented gap |
| **B** | 70–89%   | Mostly library; a few unmigrated spots                         |
| **C** | 50–69%   | Mixed; meaningful hand-rolled surface remains                  |
| **D** | 25–49%   | Mostly custom; library used decoratively                       |
| **F** | < 25%    | Library barely present                                         |

Slots the library has **no** component for are excluded from the denominator and listed
separately under "Library gaps" — they are not counted against the page.

### Severity of findings

| Severity  | Meaning                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| 🔴 High   | Raw `<button>`/`<input>`/`<table>` or a reimplemented library component            |
| 🟠 Medium | Hardcoded colors, `className` hacks imitating a variant, missing composition slots |
| 🟡 Low    | Cosmetic divergence, missing ARIA, untranslated strings                            |
| 🔵 Gap    | No library component exists — upstream feature request                             |

---

## 3. Repo-wide baseline

Snapshot taken 2026-09-20 on `feat/mieweb-ui-adoption-538`. This is the context every page
score sits inside.

| Metric                     | Value           |
| -------------------------- | --------------- |
| `.tsx` files under `src/`  | 96              |
| …that import `@mieweb/ui`  | 73 (76%)        |
| Raw `<button>` in `src/`   | 6               |
| Raw `<input>` in `src/`    | 2               |
| Raw `<select>` in `src/`   | 1               |
| Raw `<textarea>` in `src/` | 2               |
| Library components in use  | ~35 distinct    |
| Library catalog size       | 126+ components |

Raw-control counts are low because ESLint now fails the build on new raw
`button`/`input`/`select`/`textarea` in `src/` (commit `221406cf`). The remaining occurrences
are grandfathered and each needs a recorded reason.

### Most-used components

| Component                                                     | Files  |
| ------------------------------------------------------------- | ------ |
| `Text`                                                        | 42     |
| `Button`                                                      | 25     |
| `Spinner`                                                     | 23     |
| `Card` (+ `CardContent`/`CardHeader`/`CardTitle`)             | 19     |
| `Modal` slots (`ModalHeader`/`Body`/`Footer`/`Title`/`Close`) | 17     |
| `Input`                                                       | 16     |
| `Select`                                                      | 12     |
| `Table` family                                                | 6–8    |
| `Textarea`                                                    | 7      |
| `Switch`                                                      | 4      |
| `Badge`                                                       | 3      |
| `Avatar`                                                      | 2      |
| `Tabs`, `Tooltip`, `Progress`, `ButtonGroup`, `Alert`         | 1 each |

### Notable absences from the whole app

Catalog components the app never imports, despite having a use for them:

- `DataVisNitroGrid` — Rule 1 says it is the default for all tables; the app uses `Table` instead
- `Toast` — feedback is hand-rolled
- `Skeleton` — loading is `Spinner` everywhere
- `Breadcrumb`, `Pagination`, `StepIndicator`
- `Checkbox`, `Radio`, `Slider`, `DateInput`, `PhoneInput`
- `LoadingPage`, `ErrorPage`, `QuickAction`, `CountBadge`, `Timeline`

Each needs a verdict: deliberate, or backlog.

---

## 4. Route inventory

Every auditable URL and the component behind it. The **Audited** column fills in as we go.

| #   | URL                       | Page component                                                                                                                                     | Audited |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `/app/dashboard`          | [DashboardPage.tsx](../src/features/dashboard/DashboardPage.tsx)                                                                                   | ✅      |
| 2   | `/app/clock`              | [ClockPage.tsx](../src/features/clock/ClockPage.tsx)                                                                                               | ✅      |
| 3   | `/app/huddle`             | [Huddle.tsx](../src/pages/Huddle.tsx)                                                                                                              | ✅      |
| 4   | `/app/work`               | [WorkPage.tsx](../src/features/timers/WorkPage.tsx)                                                                                                | ✅      |
| 5   | `/app/tickets`            | [TicketsPage.tsx](../src/features/tickets/TicketsPage.tsx)                                                                                         | ✅      |
| 6   | `/app/tickets/:id`        | [TicketDetailPage.tsx](../src/features/tickets/TicketDetailPage.tsx)                                                                               | ✅      |
| 7   | `/app/teams`              | [TeamsPage.tsx](../src/features/teams/TeamsPage.tsx)                                                                                               | ✅      |
| 8   | `/app/profile/:id`        | [ProfilePage.tsx](../src/features/profile/ProfilePage.tsx)                                                                                         | ✅      |
| 9   | `/app/notifications`      | [NotificationsPage.tsx](../src/features/notifications/NotificationsPage.tsx)                                                                       | ✅      |
| 10  | `/app/activity`           | [ActivityLogPage.tsx](../src/features/activity/ActivityLogPage.tsx)                                                                                | ✅      |
| 11  | `/app/organization`       | [OrganizationPage.tsx](../src/features/org/OrganizationPage.tsx)                                                                                   | ✅      |
| 12  | `/app/org/members`        | [OrganizationMembersPage.tsx](../src/features/org/OrganizationMembersPage.tsx)                                                                     | ✅      |
| 13  | `/app/admin/organization` | [OrganizationOverviewPage.tsx](../src/features/org/OrganizationOverviewPage.tsx)                                                                   | ✅      |
| 14  | `/app/enterprise`         | [EnterprisePage.tsx](../src/features/enterprise/EnterprisePage.tsx)                                                                                | ✅      |
| 15  | `/app/settings`           | [SettingsPage.tsx](../src/ui/SettingsPage.tsx)                                                                                                     | ✅      |
| 16  | `/app/hi`                 | [HiPage.tsx](../src/pages/HiPage.tsx)                                                                                                              | ⬜      |
| 17  | `/app/seeder` (dev only)  | [SeederPage.tsx](../src/features/seeder/SeederPage.tsx)                                                                                            | ⬜      |
| —   | App shell (all pages)     | [AppLayout](../src/ui/AppLayout.tsx), [AppHeader](../src/ui/AppHeader.tsx), [Sidebar](../src/ui/Sidebar.tsx), [BottomNav](../src/ui/BottomNav.tsx) | ✅      |
| —   | Login / landing           | [LoginForm.tsx](../src/ui/LoginForm.tsx), [LandingPage.tsx](../src/ui/LandingPage.tsx)                                                             | ⬜      |

---

## 5. Results

Coverage = library controls / visible interactive controls, measured live. Dashboard rows are
broken out by state because it was audited state-by-state; §10 has the rest.

| Page                                | Coverage     | Grade  | Headline                                                 |
| ----------------------------------- | ------------ | ------ | -------------------------------------------------------- |
| `/app/org/members`                  | 41/41 = 100% | **A**  | Fully migrated, incl. library `Table`                    |
| `/app/settings`                     | 14/14 = 100% | **A**  | Zero raw markup; 41 hardcoded colors remain              |
| `/app/enterprise`                   | 14/14 = 100% | **A**  | ⚠️ modals source-only                                    |
| `/app/admin/organization`           | 2/2 = 100%   | **A−** | 76 lines, zero raw markup; ⚠️ granted branch source-only |
| `/app/notifications`                | 2/2 = 100%   | **A−** | Thin; hardcoded unread dot ×86                           |
| `/app/clock`                        | 1/1 = 100%   | **A−** | Thin; 4 hand-rolled pills                                |
| `/app/activity`                     | 1/1 = 100%   | **A−** | Thin; `Timeline` unused                                  |
| `/app/dashboard` → Timesheet (Team) | 16/18 = 89%  | **B**  | Admin panel well migrated                                |
| `/app/dashboard` → Timesheet (Me)   | 17/21 = 81%  | **B**  | Count pill + `Completed` status raw                      |
| `/app/dashboard` → Add Entry modal  | 7/10 = 70%   | **C**  | Correct ARIA; missing `ModalTitle`/`ButtonGroup`/`Alert` |
| `/app/dashboard` → Overview (Me)    | 12/18 = 67%  | **C**  | Hand-rolled toggles                                      |
| `/app/dashboard` → Overview (Team)  | 13/21 = 62%  | **C**  | + hand-rolled progress bar, Admin pill                   |
| `/app/tickets/:id`                  | 4/9 = 44%    | **C**  | Two hand-rolled colour maps; raw checkboxes              |
| `/app/teams`                        | 7/13 = 54%   | **C**  | Raw team chips; `CardTitle` without `Card`               |
| `/app/work`                         | 5/12 = 42%   | **C**  | Raw day strip, poor button names                         |
| `/app/profile/:id`                  | 2/5 = 40%    | **C+** | Only correct `Tabs` in the app                           |
| `/app/huddle`                       | 4/11 = 36%   | **D**  | Keyboard-inaccessible composer; menu without ARIA roles  |
| `/app/tickets`                      | 4/12 = 33%   | **D**  | All filter dropdowns raw                                 |
| `/app/organization`                 | 1/9 = 11%    | **F**  | Entire toolbar hand-rolled                               |
| **App shell**                       | see §10.4    | **D**  | Sidebar + CommandPalette use zero library components     |
| **`/app/dashboard` overall**        | ≈71%         | **B−** | 6 🔴 · 9 🟠 · 3 🟡 · 4 🔵                                |

**Not yet audited:** `/app/hi`, `/app/seeder` (dev-only), login / landing.

---

## 6. Library gaps (running list)

Things `@mieweb/ui@0.7.3` does not provide, or provides broken. These are upstream asks, not
TimeHuddle debt.

| #   | Gap / defect                                                                                                                                                                     | Found on                                                               | Current workaround                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `Dropdown` is clipped invisible inside a scroll container, which reads as "does not open" — root cause is #7                                                                     | Huddle post menu, ticket/@mention menus                                | Local [`AnchoredMenu`](../src/ui/AnchoredMenu.tsx) (commit `0851a9f9`)                                                   |
| 2   | `RichEditor` seeding regressed in 0.8.0+, pinning the whole app to 0.7.3                                                                                                         | Clock composer                                                         | Version pin                                                                                                              |
| 3   | `Button` wraps children in a non-growing label span, so it cannot host a full-width multi-line row                                                                               | Dashboard member / activity / ticket rows                              | Raw `<button>` with a comment explaining why ([DashboardPage.tsx:934](../src/features/dashboard/DashboardPage.tsx#L934)) |
| 4   | `Modal` is full-screen on mobile (`min-h-dvh`, `rounded-none`) with no prop to opt out                                                                                           | Every modal in the app                                                 | [`AppModal`](../src/ui/AppModal.tsx) — a deliberate, documented override                                                 |
| 5   | No segmented-control primitive. `Tabs` is panel-bound; `ButtonGroup` renders a button row. Neither gives a pill toggle                                                           | Dashboard (×2), Huddle Feed/Drafts                                     | Hand-rolled `aria-pressed` pills, duplicated                                                                             |
| 6   | No stat-tile / KPI component                                                                                                                                                     | Dashboard Overview (×4), personal timesheet (×5), admin timesheet (×4) | Repeated inline `Card` + two `Text`s, 13×                                                                                |
| 7   | `Dropdown` positions with `absolute`, so any menu inside an `overflow-y-auto` parent is clipped and never seen                                                                   | Huddle feed, ticket rows                                               | `AnchoredMenu` portals to `<body>` and flips above the trigger                                                           |
| 8   | `Dropdown` menu container has `data-slot="dropdown-menu"` but **no `role="menu"`**, while its children carry `role="menuitem"` — invalid ARIA, verified live in the account menu | Every library `Dropdown`                                               | None — needs a library fix                                                                                               |
| 9   | Library `Dropdown` markup uses hardcoded `bg-white` / `border-neutral-200` rather than `bg-popover` / `border-border` tokens                                                     | Every library `Dropdown`                                               | None — library-internal                                                                                                  |

---

## 7. Per-page audit template

> Copied for each page as it is audited.

### `<URL>` — `<PageName>`

**Source:** `src/…/<PageName>.tsx` (+ child components)
**Audited:** YYYY-MM-DD

#### Library components in use

| Component | Where | Notes |
| --------- | ----- | ----- |

#### Custom / hand-rolled

| What | Location | Class | Severity | Why |
| ---- | -------- | ----- | -------- | --- |

#### Library gaps found

#### Verdict

- **Coverage:** _n_/_m_ slots = _x_% → **Grade _X_**
- **Top fix:**
- **Effort to A:**

---

## 8. How to add a page to this audit

Give the URL. It gets resolved through the route table above, its component tree is walked,
and a section is appended under §9 plus a row in §5 and any new rows in §6.

---

## 9. Audited pages

_(sections appended below as each URL is audited)_

---

### `/app/dashboard` — `DashboardPage`

**Audited:** 2026-09-20 · live, via Playwright, signed in as `test user` on org _Medical Informatics Engineering_ / team 3
**States walked:** Me→Overview, Me→Timesheet, Team→Overview, Team→Timesheet, and the Add Entry modal (filled and saved a real 8h 30m entry for Sep 19, 2026)

**Source:**

| File                                                                             | Lines   | Role                                               |
| -------------------------------------------------------------------------------- | ------- | -------------------------------------------------- |
| [DashboardPage.tsx](../src/features/dashboard/DashboardPage.tsx)                 | 985     | Page shell, both toggles, Overview for both scopes |
| [PersonalTimesheetPanel.tsx](../src/features/clock/PersonalTimesheetPanel.tsx)   | 1174    | Me → Timesheet, Add Entry modal                    |
| [AdminTimesheetPanel.tsx](../src/features/teams/AdminTimesheetPanel.tsx)         | 667     | Team → Timesheet (admins)                          |
| [TimesheetApprovalsPanel.tsx](../src/features/teams/TimesheetApprovalsPanel.tsx) | 520     | Team → Timesheet approvals queue                   |
| [TimesheetRow.tsx](../src/features/clock/TimesheetRow.tsx)                       | —       | Session table rows                                 |
| [WorkspaceGreeting.tsx](../src/ui/WorkspaceGreeting.tsx)                         | 106     | Greeting banner                                    |
| [AppPage.tsx](../src/ui/AppPage.tsx) / [AppModal.tsx](../src/ui/AppModal.tsx)    | 87 / 23 | Local shell + modal wrappers                       |

#### Headline

The page splits cleanly in two. **The timesheet half is good** — it was clearly migrated, and
it uses `Card`, `Table`, `Select`, `Input`, `Modal` slots, `Badge`, `Alert` and `Button`
properly. **The overview half is the unmigrated half** — 8 raw `<button>`s, hand-rolled pills,
a hand-rolled progress bar, and 102 hardcoded color classes against **zero** design tokens.

`src/features/dashboard/DashboardPage.tsx` is on the ESLint grandfather list at
[eslint.config.mjs:134](../eslint.config.mjs#L134), so the raw controls are known and tracked
under #538 — they are backlog, not drift.

| Measure                                                                    | Value                                                                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mieweb/ui` components used on the page                                   | 14 (`Badge`, `Button`, `Card`, `CardContent`, `CardHeader`, `CardTitle`, `Spinner`, `Text`, `Select`, `Input`, `Table`+family, `Modal` slots, `Alert`, `Avatar`) |
| Raw `<button>` in `DashboardPage.tsx`                                      | **8**                                                                                                                                                            |
| Hardcoded color utilities in `DashboardPage.tsx`                           | **102**                                                                                                                                                          |
| Design-token utilities (`bg-card`, `text-muted`, …) in `DashboardPage.tsx` | **0**                                                                                                                                                            |
| Hardcoded color utilities in `WorkspaceGreeting.tsx`                       | 25                                                                                                                                                               |

#### Library components in use

| Component                                                                      | Where                                                                                                         | Notes                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Card` / `CardContent` / `CardHeader` / `CardTitle`                            | Overview stat tiles, Active tickets, Recent activity, Team members, all timesheet tiles and the Sessions card | Correct slot composition throughout                                                |
| `Text`                                                                         | Everywhere                                                                                                    | Consistent `variant`/`size`/`weight` use, `as="h2"` where a heading is meant       |
| `Button`                                                                       | "View all →" (`variant="link"`), empty-state CTAs, timesheet presets, Add Entry, modal actions, row actions   | Correct variants; `isLoading` used on save                                         |
| `Badge`                                                                        | Pending-approval count on the Timesheet toggle, ticket counts, session statuses                               | Correct `variant` + `size`                                                         |
| `Spinner`                                                                      | Page load, card-level loads                                                                                   | `label` prop supplied — good                                                       |
| `Table` / `TableHeader` / `TableBody` / `TableRow` / `TableHead` / `TableCell` | Session tables, both scopes                                                                                   | See 🔵 Rule 1 note below                                                           |
| `Select`                                                                       | Add Entry team picker, admin Member picker                                                                    | `label` prop → real `<label for>`                                                  |
| `Input`                                                                        | Add Entry clock-in/out (`type="datetime-local"`)                                                              | `label` prop → real `<label for>`                                                  |
| `Modal` slots (`ModalHeader`/`ModalBody`/`ModalFooter`)                        | Add Entry, edit-session                                                                                       | Verified live: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` all present |
| `Alert` / `AlertDescription`                                                   | Timesheet panels                                                                                              | Imported and used — but not in the Add Entry modal (see 🟠-4)                      |
| `Avatar`                                                                       | Greeting, member rows (via `UserAvatar`)                                                                      | 12-line local wrapper, fine                                                        |
| `cn`                                                                           | Local shell components                                                                                        | Correct utility use                                                                |

#### Custom / hand-rolled

| #    | What                                                                                                                                                                                                                                                                 | Location                                                                                                                                                                                      | Severity | Why                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 🔴-1 | **Both segmented toggles are hand-rolled** — a pill `<div>` wrapping two raw `<button>`s with 6-line `className` ternaries. The exact same block appears **twice** in one file (Me/Team, then Overview/Timesheet)                                                    | [DashboardPage.tsx:344-369](../src/features/dashboard/DashboardPage.tsx#L344-L369), [:410-437](../src/features/dashboard/DashboardPage.tsx#L410-L437)                                         | 🔴 + DRY | Backlog + 🔵 gap #5                                                                                                              |
| 🔴-2 | **Admin / On Break tags are raw `<span>` pills** with `bg-violet-100 text-violet-700` — literally Rule 3's ❌ example, and `Badge` is already imported in the same file                                                                                              | [DashboardPage.tsx:957-966](../src/features/dashboard/DashboardPage.tsx#L957-L966)                                                                                                            | 🔴       | Backlog                                                                                                                          |
| 🔴-3 | **Sessions count pill is a raw `<span>`** — `rounded-full bg-neutral-100 px-2 py-0.5 text-xs`                                                                                                                                                                        | [PersonalTimesheetPanel.tsx:831](../src/features/clock/PersonalTimesheetPanel.tsx#L831)                                                                                                       | 🔴       | Backlog — `Badge` or `CountBadge`                                                                                                |
| 🔴-4 | **Hand-rolled progress bar** — nested `<div>`s with `bg-blue-500` / `bg-neutral-100`. `Progress` exists in the library and is never imported anywhere in the app                                                                                                     | [DashboardPage.tsx:813-819](../src/features/dashboard/DashboardPage.tsx#L813-L819)                                                                                                            | 🔴       | Backlog                                                                                                                          |
| 🔴-5 | **Greeting banner is a bespoke card** — a raw `<div>` with a hand-written gradient, plus a raw `<span>` workspace pill                                                                                                                                               | [WorkspaceGreeting.tsx:43-58](../src/ui/WorkspaceGreeting.tsx#L43-L58), [:74-88](../src/ui/WorkspaceGreeting.tsx#L74-L88)                                                                     | 🔴       | Partly deliberate (the time-of-day gradient is a design choice), but the container should still be `Card` and the pill a `Badge` |
| 🔴-6 | **Clickable list rows are raw `<button>`s** — member rows, activity rows, active-ticket rows                                                                                                                                                                         | [DashboardPage.tsx:936](../src/features/dashboard/DashboardPage.tsx#L936), [:732](../src/features/dashboard/DashboardPage.tsx#L732), [:865](../src/features/dashboard/DashboardPage.tsx#L865) | 🔴 → 🔵  | **Genuine library gap** — the code comments the reason (gap #3). Not the app's fault                                             |
| 🟠-1 | **102 hardcoded color utilities, 0 design tokens** in `DashboardPage.tsx` — `bg-blue-50`, `text-violet-700`, `bg-green-500`, `ring-blue-500`, `bg-neutral-100`… Rule 6 says these break multi-brand theming                                                          | throughout                                                                                                                                                                                    | 🟠       | Backlog — the single biggest item by volume                                                                                      |
| 🟠-2 | **Status inconsistency:** 4 of 5 session statuses render as `Badge`; `Completed` falls through to a bare `<Text variant="muted">`                                                                                                                                    | [TimesheetRow.tsx:261-264](../src/features/clock/TimesheetRow.tsx#L261-L264)                                                                                                                  | 🟠       | Backlog — verified live, the row shows plain text where its siblings show a badge                                                |
| 🟠-3 | **The same preset chips use different variants in the two panels** — `primary`/`secondary` in the personal panel vs `primary`/`outline` in the admin panel. Visibly different controls for identical function (gray pills vs orange outlines)                        | [PersonalTimesheetPanel.tsx:667](../src/features/clock/PersonalTimesheetPanel.tsx#L667) vs [AdminTimesheetPanel.tsx:416](../src/features/teams/AdminTimesheetPanel.tsx#L416)                  | 🟠       | Backlog — pick one                                                                                                               |
| 🟠-4 | **Add Entry error is `<Text className="text-danger">`, not `Alert`** — Rule 8 says feedback states use library components, and `Alert` is already imported in this file                                                                                              | [PersonalTimesheetPanel.tsx:1134-1138](../src/features/clock/PersonalTimesheetPanel.tsx#L1134-L1138)                                                                                          | 🟠       | Backlog                                                                                                                          |
| 🟠-5 | **`ModalTitle` slot unused** — the title is `<Text weight="semibold" id="add-entry-title">` inside `ModalHeader`, so it renders as `<p>`, not a heading. Rule 4                                                                                                      | [PersonalTimesheetPanel.tsx:1100-1104](../src/features/clock/PersonalTimesheetPanel.tsx#L1100-L1104)                                                                                          | 🟠       | Backlog                                                                                                                          |
| 🟠-6 | **`ModalFooter` wraps a raw flex `<div>` instead of `ButtonGroup`** — Rule 2                                                                                                                                                                                         | [PersonalTimesheetPanel.tsx:1150](../src/features/clock/PersonalTimesheetPanel.tsx#L1150)                                                                                                     | 🟠       | Backlog                                                                                                                          |
| 🟠-7 | **Add Entry duration row is a raw `<div>`** with `bg-neutral-50 dark:bg-neutral-800`                                                                                                                                                                                 | [PersonalTimesheetPanel.tsx:1125-1132](../src/features/clock/PersonalTimesheetPanel.tsx#L1125-L1132)                                                                                          | 🟠       | Backlog                                                                                                                          |
| 🟠-8 | **Stat-tile markup repeated 13×** across the three panels (4 + 5 + 4), each an inline `Card`+`CardContent`+two `Text`s with a hardcoded icon-chip color                                                                                                              | all three panels                                                                                                                                                                              | 🟠 + DRY | 🔵 gap #6 — extract a local `StatTile` now, upstream later                                                                       |
| 🟡-1 | **Toggles use `aria-pressed`, not a tablist** — no `role="tablist"`/`aria-selected`, and no arrow-key navigation between Me/Team or Overview/Timesheet. The library `Tabs` provides all of it                                                                        | both toggles                                                                                                                                                                                  | 🟡       | Would be fixed by 🔴-1                                                                                                           |
| 🟡-2 | **No i18n** — every string is inline English (`"Good morning"`, `"Add Past Entry"`, `"Hours today"`, `"No active timers right now"`). Dates use `toLocaleDateString`, so formatting localizes but text does not                                                      | throughout                                                                                                                                                                                    | 🟡       | App-wide, not page-specific                                                                                                      |
| 🟡-3 | **Empty states are ad-hoc** — `"No clock events in this date range."` and `"No active timers right now"` are raw `<div>` + `<Text>`, while a local [`EmptyState`](../src/ui/EmptyState.tsx) component already exists and the library ships `ErrorPage`/`LoadingPage` | timesheet + overview                                                                                                                                                                          | 🟡       | Backlog                                                                                                                          |

#### What is genuinely good here

Worth recording so the migration does not undo it:

- **The Add Entry modal is correct where it counts.** Verified in the live DOM: `role="dialog"`,
  `aria-modal="true"`, `aria-labelledby="add-entry-title"`, `data-slot="modal"`, and both
  datetime inputs have real `<label for>` associations generated by `Input label=`. The modal
  body also uses `bg-card` / `border-border` tokens — because that markup is the library's.
- **`AppModal` is the right kind of wrapper.** 23 lines, documents exactly which library
  behaviour it overrides and why, and deliberately avoids targeting `[data-slot='modal']` so a
  library rename cannot silently break it. This is the pattern other overrides should copy.
- **Row actions are accessible** — `<Button variant="ghost" size="icon" aria-label="Edit session">`.
- **Raw controls carry their reason.** The member-row `<button>` has a comment naming the
  library limitation that forced it. That is what makes gap #3 reportable upstream.

#### Verdict

| State            | Coverage    | Grade  |
| ---------------- | ----------- | ------ |
| Overview (Me)    | 12/18 = 67% | **C**  |
| Overview (Team)  | 13/21 = 62% | **C**  |
| Timesheet (Me)   | 17/21 = 81% | **B**  |
| Timesheet (Team) | 16/18 = 89% | **B**  |
| Add Entry modal  | 7/10 = 70%  | **C**  |
| **Overall**      | **≈ 71%**   | **B−** |

**Top fix:** replace the two hand-rolled segmented toggles. It removes 4 of the 8 raw
`<button>`s, deletes a duplicated 28-line block, fixes 🟡-1 for free, and is the most visible
piece of non-library UI on the page.

**Effort to A:**

1. Segmented toggle → one local `SegmentedToggle` built on `ButtonGroup`, used twice _(fixes 🔴-1, 🟡-1)_
2. `Badge` for the Admin / On Break / Sessions-count pills _(fixes 🔴-2, 🔴-3)_
3. `Progress` for the member hours bar _(fixes 🔴-4)_
4. Local `StatTile` extracted once, used 13× _(fixes 🟠-8)_
5. Sweep the 102 hardcoded colors onto tokens _(fixes 🟠-1 — the long pole)_
6. Modal cleanups: `ModalTitle`, `ButtonGroup`, `Alert` for the error _(fixes 🟠-4/5/6)_

Steps 1–4 are mechanical and would take the page to roughly **85% (B+)**. Step 5 is what
separates B+ from A, and it is a sweep rather than a redesign.

**Blocked on the library:** the clickable-row pattern (gap #3) cannot be fixed in the app, and
the segmented control (gap #5) has no clean primitive today.

#### 🔵 Rule 1 note — `Table` vs `DataVisNitroGrid`

Both session tables use `Table`. Rule 1 says `DataVisNitroGrid` is the default for all tables
and `Table` is for "only if the human insists". `DataVisNitroGrid` is **not imported anywhere
in the app**. This needs one deliberate decision rather than a per-page finding — these are
small, fixed-column, edit-in-place tables, which is arguably exactly where plain `Table` is the
right call. Recorded here; to be settled before the ticket/member pages are audited.

---

## 10. App-wide sweep — 12 pages + the shell

**Audited:** 2026-09-20 · live in Playwright as `test user`, org _Medical Informatics Engineering_ / team 3.

### 10.1 Method and its limits

Each page was loaded live and measured in the rendered DOM, not just in source. A control counts
as **library** when it carries the library's own `data-slot` marker (`button`, `select-trigger`,
`dropdown-item`, `switch`, `input`, …). That is the only reliable signal, because a hand-rolled
`<button>` styled to look right is indistinguishable from a `Button` in a screenshot.

Two corrections worth recording, because they changed the numbers:

- **The first probe was wrong.** It tested element size but not inherited CSS visibility, so it
  counted the Tickets panel — which stays mounted at `visibility: hidden` after you navigate away
  — as part of whatever page came next. Teams, for example, first measured 23 buttons; it has 13.
  Every figure below was re-measured with `Element.checkVisibility()`.
- **"86 pills" on Notifications was a miscount.** It is one hand-rolled unread dot
  (`h-2.5 w-2.5 rounded-full bg-blue-500`) repeated once per notification — a single pattern to
  fix, not 86 findings.

**What this pass does not cover.** Modals and menus were opened on Dashboard, Huddle, Tickets and
the shell. On Teams, Work, Enterprise, Settings, Members, Organization and Profile the _page_ was
walked live but their modals were read in source only. Those pages' modal internals are therefore
graded on source, and are marked ⚠️ below. `/app/admin/organization` was reached, but only its access-denied branch renders for the test user.

### 10.2 Scoreboard

Coverage here is **library controls ÷ visible interactive controls** (buttons + form fields).

| Page                      | Lib / total controls | Coverage | Grade  | Notes                                                                       |
| ------------------------- | -------------------- | -------- | ------ | --------------------------------------------------------------------------- |
| `/app/org/members`        | 41 / 41              | 100%     | **A**  | 39 buttons, 2 fields, library `Table` — all library                         |
| `/app/settings`           | 14 / 14              | 100%     | **A**  | 6 Cards, 5 Badges, 1 Switch, zero raw markup                                |
| `/app/enterprise`         | 14 / 14              | 100%     | **A**  | ⚠️ modals source-only; 1 unlabelled field                                   |
| `/app/admin/organization` | 2 / 2                | 100%     | **A−** | Smallest page in the app; ⚠️ only the denied branch renders for this user   |
| `/app/notifications`      | 2 / 2                | 100%     | **A−** | Only 2 controls; 86× hardcoded unread dot                                   |
| `/app/clock`              | 1 / 1                | 100%     | **A−** | Only 1 control; 4 hand-rolled pills                                         |
| `/app/activity`           | 1 / 1                | 100%     | **A−** | Near-empty; timeline is raw divs, `Timeline` unused                         |
| `/app/tickets/:id`        | 4 / 9                | 44%      | **C**  | View mode; edit mode better at 6/8                                          |
| `/app/teams`              | 7 / 13               | 54%      | **C**  | 5 team chips raw; panel is a hand-rolled card holding a library `CardTitle` |
| `/app/work`               | 5 / 12               | 42%      | **C**  | 7 raw day-strip buttons named "14 Mon17m"                                   |
| `/app/profile/test_user`  | 2 / 5                | 40%      | **C+** | Low count, but the **only** correct `Tabs` in the app                       |
| `/app/huddle`             | 4 / 11               | 36%      | **D**  | Composer is a bare `<div>`; menu has no `role="menu"`                       |
| `/app/tickets`            | 4 / 12               | 33%      | **D**  | All 4 filter dropdowns raw                                                  |
| `/app/organization`       | 1 / 9                | 11%      | **F**  | Entire org-chart toolbar hand-rolled                                        |
| **App shell**             | see §10.4            | —        | **D**  | Sidebar and CommandPalette use **zero** library components                  |

> Read the three A− grades carefully. A page with one visible control scores 100% on a metric
> built for pages with thirty. Clock, Activity and Notifications are _clean_, not _proven_ — their
> quality claim rests on the source scan, not the control count.

### 10.3 The five findings that matter most

**🔴-A1 · The "Post" button is off-brand.** The primary action on Huddle renders
`bg-indigo-500 dark:bg-indigo-600` — computed `oklch(0.511 0.262 276.966)`, an indigo pill — while
every other primary action in the app is the brand orange. It is a raw `<button>`, not a
`Button variant="primary"`. This is Rule 6 at its most visible: the app's most-used action button
ignores the brand entirely. [HuddleComposer.tsx](../src/features/huddle/HuddleComposer.tsx)

**🔴-A2 · The Huddle composer cannot be reached by keyboard.** The "Share an update…" trigger is a
bare `<div class="cursor-pointer">` — verified live: `role` null, `tabindex` null, `aria-label`
null. A keyboard or screen-reader user cannot start a post at all. This is the single most severe
accessibility defect found. [HuddleComposer.tsx](../src/features/huddle/HuddleComposer.tsx)

**🔴-A3 · The Huddle post menu promises a menu it never builds.** The trigger sets
`aria-haspopup="menu"` and `aria-expanded="true"`, but the opened menu has **no** `role="menu"` and
no `role="menuitem"` — verified live, `[role=menu]` returns zero matches while "Edit post" /
"Delete post" are visibly on screen. It is a raw `<div>` of raw `<button>`s with a hand-drawn SVG
kebab and hardcoded `bg-white` / `text-red-600`, positioned `absolute` — the exact clipping trap
[AnchoredMenu](../src/ui/AnchoredMenu.tsx) was written to escape. The app's _own_ `AnchoredMenu`
does this correctly (`role="menu"`, arrow-key roving focus); this menu does not use it.
[PostCard/index.tsx:230-247](../src/features/huddle/PostCard/index.tsx#L230-L247)

**🔴-A4 · `CommandPalette` is a 520-line reimplementation of a library component.** The library
ships `CommandPalette` (Rule 3, Actions row). The app's version imports **nothing** from
`@mieweb/ui` and carries **83** hardcoded color utilities. This is the largest single duplication
of library functionality in the codebase. [CommandPalette.tsx](../src/ui/CommandPalette.tsx)

**🔴-A5 · The Sidebar uses zero library components.** 342 lines, 3 raw `<button>`s, 32 hardcoded
colors, not one `@mieweb/ui` import — and it is on screen on every single page.
[Sidebar.tsx](../src/ui/Sidebar.tsx)

### 10.4 App shell

On screen everywhere, so its findings multiply across all 17 routes.

| Component                                                  | Lines | Library components                  | Raw btn     | Hardcoded colors | Verdict                               |
| ---------------------------------------------------------- | ----- | ----------------------------------- | ----------- | ---------------- | ------------------------------------- |
| [Sidebar.tsx](../src/ui/Sidebar.tsx)                       | 342   | **none**                            | 3           | 32               | 🔴 A5                                 |
| [CommandPalette.tsx](../src/ui/CommandPalette.tsx)         | 520   | **none**                            | 0           | 83               | 🔴 A4 — library has this component    |
| [BottomNav.tsx](../src/ui/BottomNav.tsx)                   | 422   | `Button` only                       | 6           | 41               | 🔴 mobile nav essentially hand-rolled |
| [AppHeader.tsx](../src/ui/AppHeader.tsx)                   | 106   | `Button`                            | 0           | 3                | 🟢 thin and clean                     |
| [UserDropdown.tsx](../src/ui/UserDropdown.tsx)             | 200   | `Dropdown` + 3 slots                | 1 (trigger) | 1                | 🟢 good — see below                   |
| [OrgTeamSwitcher.tsx](../src/ui/OrgTeamSwitcher.tsx)       | 246   | `Modal` slots, `Select`, `Badge`    | 3           | 13               | 🟠 mixed                              |
| [UsernameClaimModal.tsx](../src/ui/UsernameClaimModal.tsx) | 228   | 8 incl. `ButtonGroup`, `ModalTitle` | 0           | 8                | 🟢 **best-composed modal in the app** |
| [ThemeToggle.tsx](../src/ui/ThemeToggle.tsx)               | 19    | `Button`, `Tooltip`                 | 0           | 0                | 🟢                                    |

**The account dropdown you asked about is one of the good ones.** Verified live: the library
`Dropdown` opens correctly, injects `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`
onto the trigger, and renders nine items each with `role="menuitem"` and
`data-slot="dropdown-item"`. Two caveats:

- Its trigger is a raw `<button>` with a hardcoded `ring-blue-500/40` focus ring.
- **Library defect:** the menu container carries `data-slot="dropdown-menu"` but **no
  `role="menu"`** — verified live. `menuitem` children without a `menu` parent are invalid ARIA, so
  assistive tech does not announce it as a menu. This is in the library's own markup, not the app's.
  Logged as gap #8.

### 10.5 Per-page detail

One section per page, worst-graded first. Each states how deeply it was verified: **live** means
the control was inspected in the rendered DOM, **source** means the file was read but the UI was
not exercised.

Three composition rules are missed on _every_ page, so they are stated once here rather than
repeated fourteen times:

| Rule                                               | Component     | Used in                                                             | Out of                         |
| -------------------------------------------------- | ------------- | ------------------------------------------------------------------- | ------------------------------ |
| Rule 2 — sibling buttons belong in a `ButtonGroup` | `ButtonGroup` | **1 file** ([UsernameClaimModal](../src/ui/UsernameClaimModal.tsx)) | 96 `.tsx` files                |
| Rule 8 — feedback states use library components    | `Alert`       | **2 files** (both timesheet panels)                                 | 96                             |
| Rule 4 — use the composition slot                  | `ModalTitle`  | **7 files**                                                         | 18 files that render a `Modal` |

---

#### `/app/organization` — 11%, **F** · verified live

1 of 9 controls is a library component. The lowest score in the app.

| Finding                                                       | Detail                                                                                                                                              | Severity |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **The entire org-chart toolbar is hand-rolled**               | Seven raw buttons verified live: `Fit to Screen`, `Reset Position`, `Expand All`, `Collapse All`, `Adjust Child Columns`, `Swap Mode`, `Export SVG` | 🔴       |
| **`OrganizationChart.tsx` imports nothing from the library**  | 434 lines, 2 raw `<button>`, 29 hardcoded colours, zero `@mieweb/ui` imports                                                                        | 🔴       |
| **A seven-button toolbar is the textbook `ButtonGroup` case** | Rule 2, unused here as everywhere                                                                                                                   | 🟠       |
| **One raw form control**                                      | Not a library `Input`/`Select`                                                                                                                      | 🟠       |

✅ The page wrapper, [OrganizationPage.tsx](../src/features/org/OrganizationPage.tsx) (128 lines),
is fine — `Button`, `Spinner`, `Text`. The chart inside it is the problem.

**Top fix:** the toolbar is one contained file. Converting it to `Button` + `ButtonGroup` moves
this page from F to roughly B on its own.

---

#### `/app/tickets` — 33%, **D** · verified live incl. menus and the create panel

4 of 12 controls library.

| Finding                                                         | Detail                                                                                                                                                                                                         | Severity |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **All four filter dropdowns are raw**                           | `Team:`, `Priority`, `Status`, `Assignee` — verified live, no `data-slot`                                                                                                                                      | 🔴       |
| **The New Ticket panel is a library `Card` restyled off-brand** | Computed classes include `border-blue-200 bg-blue-50/50` layered onto `bg-card text-card-foreground shadow-card`. Rule 5 (className instead of variant) **and** Rule 6 (off-brand blue) on a library component | 🟠       |
| **The two count chips are raw buttons**                         | "1 Open" / "0 Closed"                                                                                                                                                                                          | 🟠       |
| **Largest, most colour-hardcoded file in the app**              | [TicketsPage.tsx](../src/features/tickets/TicketsPage.tsx): **1930 lines, 132 hardcoded colours**, 3 tokens                                                                                                    | 🟠       |

✅ **Good:** the `Ticket options` menu is [`AnchoredMenu`](../src/ui/AnchoredMenu.tsx) with a
correct `role="menu"` and five `role="menuitem"` children — verified live. All inputs are library
`Input` with real label associations. `New Ticket` and `Start timer` are library `Button`s with
descriptive `aria-label`s.

---

#### `/app/huddle` — 36%, **D** · verified live incl. composer and post menu

4 of 11 controls library. Holds three of the app's five worst findings.

| Finding                                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                            | Severity |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **The composer cannot be reached by keyboard**            | "Share an update…" is a bare `<div class="cursor-pointer">` — verified live: `role` null, `tabindex` null, `aria-label` null. No keyboard or screen-reader user can start a post                                                                                                                                                                                                                                  | 🔴 🔴    |
| **The post menu promises a menu it never builds**         | Trigger sets `aria-haspopup="menu"` + `aria-expanded="true"`, but `[role=menu]` returns **zero** matches while "Edit post"/"Delete post" are visibly open. Raw `<div>` of raw `<button>`s, hand-drawn SVG kebab, hardcoded `bg-white`/`text-red-600`, positioned `absolute` — the clipping trap `AnchoredMenu` exists to avoid. [PostCard/index.tsx:230-247](../src/features/huddle/PostCard/index.tsx#L230-L247) | 🔴       |
| **The "Post" button is off-brand indigo**                 | `bg-indigo-500 dark:bg-indigo-600`, computed `oklch(0.511 0.262 276.966)`, while every other primary action is brand orange. Raw `<button>`, not `Button variant="primary"`                                                                                                                                                                                                                                       | 🔴       |
| **Reaction buttons are named "0"**                        | Two buttons whose entire accessible name is the digit `0` — no `aria-label`, no `title`. A screen reader announces "0, button"                                                                                                                                                                                                                                                                                    | 🔴       |
| **7 of 8 composer action buttons are raw**                | `Photo`, `Video`, `Doc`, `Pulse`, `@Mention`, `Cancel`, `Post`. Only `Ticket` is a library `Button`                                                                                                                                                                                                                                                                                                               | 🔴       |
| **Feed/Drafts repeats the hand-rolled pill toggle**       | Same `aria-pressed` pattern as the Dashboard (P1)                                                                                                                                                                                                                                                                                                                                                                 | 🔴       |
| **Worst single file in the app**                          | [PostCard/index.tsx](../src/features/huddle/PostCard/index.tsx): 512 lines, 8 raw `<button>`, 76 hardcoded colours                                                                                                                                                                                                                                                                                                | 🟠       |
| **`HuddleComposer.tsx` imports nothing from the library** | 403 lines, 40 hardcoded colours                                                                                                                                                                                                                                                                                                                                                                                   | 🟠       |

✅ **Good:** the rich editor is the library's own Kerebron `RichEditor` and supplies ~20 correctly
-labelled toolbar buttons (excluded from the count above so they do not flatter the score). The
`Ticket` button shows the intended direction — it came from the `TicketPicker` migration
(commit `afa47508`).

---

#### `/app/profile/:id` — 40%, **C+** · verified live (page only; edit modals source)

Only 5 controls, but this page matters out of proportion to its score.

| Finding                                                                                | Detail                                                                                                                                                                                                                                                                               | Severity         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| ✅ **The reference implementation for tabs**                                           | Verified live: one `role="tablist"` with three `role="tab"` children, built from library `Tabs`/`TabsList`/`TabsTrigger`. **The only correct tablist in the app.** This is exactly what the Dashboard and Huddle toggles should become — the pattern already exists in this codebase | —                |
| **The three tab triggers report as raw**                                               | They carry `role="tab"` rather than `data-slot="button"`, which is correct for `TabsTrigger`; counted as "raw" by the probe but they are library components. The 40% figure understates this page                                                                                    | measurement note |
| **Colour-hardcoded satellites**                                                        | [ProfileWorkSnapshot.tsx](../src/features/profile/ProfileWorkSnapshot.tsx) 39 hardcoded colours, [ProfileActivityFeed.tsx](../src/features/profile/ProfileActivityFeed.tsx) 35, [CompactTicketList.tsx](../src/features/profile/CompactTicketList.tsx) 33                            | 🟠               |
| **Four files on the ESLint grandfather list**                                          | `ProfilePage`, `ProfileFeed`, `UsernameBadge`, `WorkSummaryTags`                                                                                                                                                                                                                     | 🟠               |
| **`UsernameBadge` and `WorkSummaryTags` are raw-button files with no library imports** | 51 and 41 lines                                                                                                                                                                                                                                                                      | 🟠               |

✅ 50 library `Card`s render in the feed; `Badge`, `Spinner` and `Text` used throughout.

---

#### `/app/work` — 42%, **C** · verified live (page only; modals source)

5 of 12 controls library.

| Finding                                           | Detail                                                                                                                                                                                                               | Severity |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **The 7-button day strip is raw and badly named** | Each button's accessible name is a run-together string — verified live as `"14 Mon17m"`, `"15 Tue0m"` … — the day, weekday and duration concatenated with no `aria-label`. A screen reader reads "14 Mon17m, button" | 🔴 🟡    |
| **A 7-day strip is a `ButtonGroup`**              | Rule 2                                                                                                                                                                                                               | 🟠       |
| **Two files grandfathered**                       | `WorkPage.tsx`, `TodayStatusCard.tsx`                                                                                                                                                                                | 🟠       |

✅ **Genuinely strong underneath:** [WorkPage.tsx](../src/features/timers/WorkPage.tsx) uses **16**
library components (`Modal` slots, `Table` family, `Select`, `Input`, `Badge`, `Card`, `Spinner`)
with **zero hardcoded colours and 6 design tokens** — one of only two files in the app that
prefers tokens over literal colours. [TodayStatusCard.tsx](../src/features/timers/TodayStatusCard.tsx)
is likewise 0 hardcoded / 7 tokens. **This is the token discipline the rest of the app lacks.**

---

#### `/app/teams` — 54%, **C** · verified live (page only; ⚠️ modals source)

7 of 13 controls library.

| Finding                                             | Detail                                                                                                                                                                                                                         | Severity |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| **The 5 team chips are raw buttons**                | `Personal`, `team 3`, `team 2`, `team 4`, `Team test` — though correctly brand-orange when active                                                                                                                              | 🔴       |
| **A library `CardTitle` inside a hand-rolled card** | [TeamsPage.tsx](../src/features/teams/TeamsPage.tsx) imports `CardTitle` but **not** `Card` or `CardContent` — verified live, zero `data-slot="card"` on the page. The members panel is bespoke markup wearing a library title | 🟠       |
| **A chip row is a `ButtonGroup`**                   | Rule 2                                                                                                                                                                                                                         | 🟠       |
| **1356 lines, 27 hardcoded colours**                | Large file, moderate colour debt                                                                                                                                                                                               | 🟠       |

✅ **Good:** 20 library components imported including `Modal` slots, `ModalTitle`, `Switch`,
`Table` family and `Dropdown` — ⚠️ read in source, not exercised live. Two `Badge`s render on the
page. The Admin badge and member kebab are library components.

---

#### `/app/tickets/:id` — 44%, **C** · verified live in both view and edit mode

Audited on ticket `#161cf`. **View mode:** 9 visible controls, 4 library. **Edit mode is better**
— 6 of 8 buttons library, because the raw pencil collapses into library `Save`/`Cancel`.

| Finding                                                    | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Severity |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| **Two hand-rolled colour maps feed two hand-rolled pills** | [`statusColor()`](../src/features/tickets/TicketDetailPage.tsx#L63) and [`priorityColor()`](../src/features/tickets/TicketDetailPage.tsx#L48) return ten hardcoded `bg-*-100 text-*-800` pairs, applied to `<span className="rounded-full px-2 py-0.5 …">` at [345](../src/features/tickets/TicketDetailPage.tsx#L345) and [351](../src/features/tickets/TicketDetailPage.tsx#L351). `Badge` already ships `success`/`warning`/`danger`/`secondary` variants covering exactly these states | 🔴       |
| **Assignee checkboxes are raw `<input type="checkbox">`**  | [line 556](../src/features/tickets/TicketDetailPage.tsx#L556). Library `Checkbox` is never imported anywhere in the app. `accent-color` computes to `auto`, so they render in browser-default blue against an orange-branded app                                                                                                                                                                                                                                                           | 🔴       |
| **Delete button imitates `variant="danger"`**              | [line 648](../src/features/tickets/TicketDetailPage.tsx#L648) — raw `<button>` hand-styled `bg-destructive-500 … hover:bg-destructive-600`. Token-based, but still Rule 5                                                                                                                                                                                                                                                                                                                  | 🟠       |
| **Back button is raw**                                     | [line 285](../src/features/tickets/TicketDetailPage.tsx#L285), nine hardcoded neutral classes                                                                                                                                                                                                                                                                                                                                                                                              | 🟠       |
| **110 hardcoded colours, 5 tokens**                        | Second-most colour-hardcoded file after `TicketsPage.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                  | 🟠       |

✅ **Good:** 5 library `Card`s; `Status` and `Priority` are library `Select`s with `aria-label`s;
the description editor is a library `Textarea` with `aria-label="Ticket description"`; `Save`,
`Cancel`, `Add link` and `Upload video` are all library `Button`s; raw icon buttons do carry
correct `aria-label`s; and the checkboxes are wrapped in `<label>`, giving an implicit name.

> Probe correction: it first reported both checkboxes as "unlabelled" because it only checked
> `aria-label` and `label[for=…]`. The `<label>` wrapping is valid — the finding is the raw element
> and the off-brand accent, not a missing name.

---

#### `/app/notifications` — 100% of 2 controls, **A−** · verified live

Both visible buttons (`Mark all read`, `Select`) are library. But the page is thin on library
structure underneath.

| Finding                                                   | Detail                                                                                                                                                | Severity |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **The unread dot is a hardcoded off-brand blue**          | `h-2.5 w-2.5 rounded-full bg-blue-500`, one per notification — verified live at **86 instances** on this account. One pattern to fix, not 86 findings | 🟠       |
| **Zero `Card`, zero `Badge`, zero `Spinner`**             | 601 lines rendering a list with no library structural components                                                                                      | 🟠       |
| **Grandfathered; 1 raw `<button>`, 22 hardcoded colours** |                                                                                                                                                       | 🟠       |
| **Rows are bare `<li>` with no role of their own**        | Verified live                                                                                                                                         | 🟡       |

✅ Uses `Modal` slots **including `ModalTitle`** — one of only 7 files that do.

---

#### `/app/clock` — 100% of 1 control, **A−** · verified live

The cleanest feature page in the app. `ClockPage.tsx`: 8 library components, 4 `Card`s, 3 `Badge`s,
2 `Spinner`s, and only 24 hardcoded colours across 730 lines.

| Finding                                     | Detail        | Severity |
| ------------------------------------------- | ------------- | -------- |
| **4 hand-rolled pills**                     | Verified live | 🟠       |
| **1 raw `<button>`; file is grandfathered** |               | 🟠       |

> With one visible control, the 100% figure is not a meaningful coverage claim. This page's grade
> rests on its source, not its control count.

---

#### `/app/activity` — 100% of 1 control, **A−** · verified live (near-empty state)

| Finding                                               | Detail                                                                                                   | Severity |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| **The log is raw divs; `Timeline` is never imported** | An activity log is the library's `Timeline` use case exactly. Zero `Card`, zero `Badge` across 273 lines | 🟠       |
| **22 hardcoded colours, 0 tokens**                    | Includes `text-red-400`, `text-blue-500` type colours                                                    | 🟠       |

✅ Its one button and its `Spinner` are library. No raw form controls, not grandfathered.

> Audited in a near-empty state — few rows were present to exercise.

---

#### `/app/enterprise` — 100% of 14 controls, **A** · verified live (page only; ⚠️ modals source)

13 of 13 buttons and the single field are library. 4 `Card`s.

| Finding                                           | Detail                                                                                                   | Severity |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| **One unlabelled field**                          | Verified live                                                                                            | 🟡       |
| **31 hardcoded colours, 0 tokens**                | Incl. `text-red-700`/`text-red-300` for danger states, where `Alert` or `Badge variant="danger"` belongs | 🟠       |
| **No `Alert`, no `ButtonGroup`, no `ModalTitle`** | Despite rendering modals and danger states                                                               | 🟠       |

✅ 712 lines using `Modal` slots, `Select`, `Input`, `Switch`, `Card` family, `Spinner`, `Button`,
`Text`. Not grandfathered — no raw controls at all.

---

#### `/app/settings` — 100% of 14 controls, **A** · verified live

10 of 10 buttons and 4 of 4 fields are library. 6 `Card`s, 5 `Badge`s, 1 `Switch`, zero raw markup,
zero hand-rolled pills. Not on the grandfather list.

| Finding                                   | Detail                                                                                   | Severity |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| **41 hardcoded colours, 0 design tokens** | The highest colour debt of any A-grade page — 949 lines                                  | 🟠       |
| **One unlabelled field**                  | Verified live                                                                            | 🟡       |
| **No `Alert`, no `ButtonGroup`**          | A settings page with save/cancel pairs and status messaging is the natural home for both | 🟠       |

**This is the migration target.** Component adoption is complete; what remains is the colour sweep.

---

#### `/app/org/members` — 100% of 41 controls, **A** · verified live (page; ⚠️ modals source)

The best page in the app by a clear margin: **39 of 39 buttons**, **2 of 2 fields**, and a library
`Table` (`data-slot="table"` confirmed live) — 41 for 41, none unlabelled.

| Finding                                           | Detail                                                                                                    | Severity |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| **1 hand-rolled pill**                            | Verified live                                                                                             | 🟡       |
| **16 hardcoded colours**                          | Lowest of any large page; incl. `text-amber-700`/`text-amber-300` where `Badge variant="warning"` belongs | 🟠       |
| **No `Alert`, no `ButtonGroup`, no `ModalTitle`** | ⚠️ its modals were read in source only                                                                    | 🟠       |

✅ 21 library components across 768 lines: `Modal` slots, `Table` family, `Select`, `Input`,
`Switch`, `Textarea`, `Badge`, `Card` family, `Spinner`. Not grandfathered.

**Proof the target is reachable** — this page is the same kind of dense admin table that
`/app/tickets` is, and it scored 100% where Tickets scored 33%.

---

#### `/app/admin/organization` — 100% of 2 controls, **A−** · ⚠️ only the denied branch renders

At 76 lines it is the smallest page in the app and, per line, the most disciplined: **every**
element is a library component — `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Text`,
`Button` — with zero raw controls, zero hardcoded colours, zero hand-rolled pills.

⚠️ `test user` has no `organizationMembership.role` of `owner`/`admin`, so
[`hasDefaultOrganizationAdminAccess()`](../src/lib/organizationAccess.ts#L21) returns false and the
page renders "Organization Admin Unavailable". The granted branch is graded from source.

| Finding                                                             | Detail                                                                                                                                                                                                                                             | Severity |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Two `Button`s in a raw `<div className="flex flex-wrap gap-2">`** | [line 63](../src/features/org/OrganizationOverviewPage.tsx#L63) — Rule 2. The one real library-usage miss                                                                                                                                          | 🟠       |
| **API errors are swallowed silently**                               | `catch { /* Silently handle error, display fallback text */ }` at [line 19](../src/features/org/OrganizationOverviewPage.tsx#L19). If `getOrganization()` fails the card reads "Organization" with no sign anything broke. Rule 8 wants an `Alert` | 🟠       |
| **No loading state**                                                | `organization` starts `null` and the title swaps in after the fetch; `Spinner`/`Skeleton` unused                                                                                                                                                   | 🟡       |
| **Heading jumps H1 → H3**                                           | Verified live: page `<h1>` "Organization Admin", next heading is the `CardTitle` `<h3>`, no `<h2>` between                                                                                                                                         | 🟡       |
| **Two cosmetic slips**                                              | Empty `className=""` on `CardHeader` ([50](../src/features/org/OrganizationOverviewPage.tsx#L50)); stray trailing space inside `CardTitle` ([51](../src/features/org/OrganizationOverviewPage.tsx#L51))                                            | 🟡       |

**Verdict:** the component work is done. What it lacks is _state_ coverage. Adding `ButtonGroup`
and an `Alert` on the swallowed error makes it a clean **A**.

---

### 10.6 App-wide patterns

| #   | Pattern                                                      | Where                                                                                                                                                          | Severity                                            |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| P1  | **Hand-rolled `aria-pressed` pill toggle** instead of `Tabs` | Dashboard (×2), Huddle Feed/Drafts                                                                                                                             | 🔴 — and `/app/profile` already shows the right way |
| P2  | **Hardcoded colors everywhere, tokens almost nowhere**       | 132 in Tickets, 110 in TicketDetail, 83 in CommandPalette, 102 in Dashboard, 76 in PostCard                                                                    | 🟠 — breaks multi-brand theming                     |
| P3  | **Off-brand accent colors on primary surfaces**              | indigo Post button, blue New-Ticket panel, blue unread dot, blue focus rings                                                                                   | 🔴                                                  |
| P4  | **Clickable `<div>`s and unnamed buttons**                   | Huddle composer, "0" reactions, "14 Mon17m" day strip                                                                                                          | 🔴 keyboard/SR blockers                             |
| P5  | **Three different menu implementations coexist**             | library `Dropdown` (UserDropdown, Teams), local `AnchoredMenu` (Tickets), raw div (Huddle posts)                                                               | 🟠 — only the raw one is inaccessible               |
| P6  | **Catalog components never imported**                        | `DataVisNitroGrid`, `Toast`, `Skeleton`, `Progress`, `Timeline`, `Checkbox`, `Radio`, `Breadcrumb`, `Pagination`, `CommandPalette`, `LoadingPage`, `ErrorPage` | 🟠                                                  |
| P7  | **No i18n anywhere**                                         | every page                                                                                                                                                     | 🟡                                                  |

### 10.7 Where the effort should go

Ranked by severity × reach, not by file size:

1. **Huddle composer keyboard access** (🔴-A2) — a correctness bug, not a style one. One page, one element.
2. **The indigo Post button and the other off-brand accents** (P3) — small diffs, immediately visible, they make the app look un-branded.
3. **Huddle post menu → `AnchoredMenu`** (🔴-A3) — the app already owns the accessible component; this is a swap, not a build.
4. **Sidebar + BottomNav + CommandPalette** (🔴-A4, 🔴-A5) — biggest reach, on every route. CommandPalette may be a deletion rather than a rewrite if the library's version fits.
5. **The `Tabs` sweep** (P1) — copy the pattern `/app/profile` already uses.
6. **Org-chart toolbar** (F grade) — contained, one file.
7. **The hardcoded-color sweep** (P2) — the long pole, best done per-file alongside other work.

### 10.8 New library gaps found

Added to §6: gap #7 (`Dropdown` clipped inside scroll containers — the real cause behind the
earlier "does not open" note) and gap #8 (`Dropdown` menu container missing `role="menu"`).
