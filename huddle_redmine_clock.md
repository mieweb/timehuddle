# TimeHuddle ↔ Redmine — Clock & Time-Sync (Simplified v1)

Scoped-down plan derived from `plan_timehuddle_redmine`. This is the **first deliverable only**.

## Goal

A user should never have to open Redmine to:

1. see which tickets are assigned to them, or
2. manually enter "Spent time" after working.

They connect their Redmine account once, pick their assigned ticket on the clock page,
work (with start/stop, breaks, multiple sessions tracked in TimeHuddle), and the total
hours are pushed to Redmine automatically.

## Scope

**In scope**

- Connect a personal Redmine account in TimeHuddle via **personal API key**.
- Surface Redmine issues on the tickets page (**read-only issues, one-way Redmine → TimeHuddle**).
  Delivered in two steps: M2 ships a separate "Redmine Tickets" view behind a heading dropdown;
  **M2.1 replaces that switcher with a single unified table covering every source.**
- A **scope toggle "Assigned to me" / "All"** (drives the fetch) plus working search, sort, and filters.
- Start a **ticket timer against a Redmine issue** from the clock page dropdown or a "Start working" button on the Redmine view — reusing the existing source-aware ticket-timer mechanism (not the team shift clock).
- All timing logic (start/end, breaks, multiple sessions) lives in TimeHuddle.
- Push the **summed hours** for a work session back to Redmine as a time entry.

**Explicitly out of scope (defer)**

- Creating/editing Redmine issues from TimeHuddle (no write-back of tickets) — see **M6**.
- Two-way ticket sync of any kind, and persisting Redmine issues in TimeHuddle's database — see **M6**.
- Estimated hours, watchers, categories, versions, parent/subtasks, custom fields.
- Role-aware / workflow-filtered dropdowns (Reporter tier, status transitions).
- Admin bulk onboarding, invites, auto-match by email, create-user-in-Redmine.
- Reconciliation / drift-detection background job.
- Git changesets display.

**Direction:** issues flow **Redmine → TimeHuddle** (read-only). Only **time entries**
flow **TimeHuddle → Redmine** (write). Nothing else is written to Redmine in v1.

---

## Milestone 1 — Connect a Redmine account (personal API key)

Let a TimeHuddle user link their own Redmine identity using their personal API key.

- [x] New collection `redmine_links` (`meteor-backend/server/collections.js`):
      `{ userId, redmineUserId, redmineLogin, firstname, lastname, mail, apiKey (encrypted), linkedAt }`.
      _`baseUrl` is intentionally **not** persisted — the configured instance is the single
      source of truth, derived at read time (`toStatus`). A unique `userId` index enforces
      one link per user._
- [x] Store the Redmine base URL as config/env (`REDMINE_BASE_URL`), not hardcoded.
- [x] Encrypt the personal API key at rest; never return it to the client after saving.
      _AES-256-GCM via `redmine-crypto.js` (`REDMINE_ENCRYPTION_KEY`); `toStatus` strips the key._
- [x] `meteor-backend/server/redmine-client.js` — thin `fetch` wrapper:
      builds requests against `baseUrl`, injects the caller's API key
      (`X-Redmine-API-Key` header), 8s timeout, `.status` on errors.
      _M1 implements `getCurrentUser` only; `listIssues` / `createTimeEntry` /
      `updateTimeEntry` are deferred to M2 / M5 to avoid dead code._
- [x] Meteor method `redmine.connect(apiKey)`: - call `GET /users/current.json` with that key to validate, - on success, upsert a `redmine_links` row for the current user, - on failure, return a clear "invalid key / unreachable" error.
- [x] Meteor method `redmine.disconnect()` — remove the link row.
      _Also added `redmine.status()` for the client-safe connection status._
- [x] Frontend: **Settings → "Add Redmine account"** — paste API key, show
      connected state (Redmine login + a "Disconnect" action).
- [ ] Show connection status somewhere on the tickets/clock page (connected vs. not).
      _Deferred into M2: surfaced as the "not connected" state on the Redmine Tickets view._

**Done when:** a user pastes their personal API key, sees their Redmine login confirmed,
and the link persists across sessions.

---

## Milestone 2 — Add a "Redmine Tickets" view to the tickets page (read-only issues)

Add a second **view** to the tickets page alongside the existing TimeHuddle tickets,
switched via a heading dropdown. "Read-only" here means **read-only for the Redmine
issue data** — no create/edit/delete of issues. (Starting a local timer against a
Redmine issue is a TimeHuddle write, not a Redmine write, and is covered in M3/M4.)

**Architecture (decided):** a **separate, thin Redmine data layer** — its own
`RedmineIssue` type + `redmine.issues.*` method surface — rendered by its own
`RedmineTicketsView` component that reuses `@mieweb/ui` primitives. We do **not**
adapt Redmine issues into the internal `Ticket` shape, and we do **not** build a
generic pluggable "ticket source" abstraction (YAGNI/KISS). Future Redmine issue CRUD,
if ever needed, extends `redmine.issues.*` — never the core `Ticket` collection.

- [x] `redmine-client.listIssues(apiKey, { scope, limit, offset })`: - assigned to me → `GET /issues.json?assigned_to_id=me`, - all (visible to the key) → `GET /issues.json` (paginate via `limit`/`offset`).
- [x] Meteor method `redmine.issues.list({ scope: 'mine' | 'all' })` using the
      caller's stored API key (each user sees what their own key can see). Returns a
      **minimal, pre-shaped DTO** (shaping done server-side) plus the configured `baseUrl`.
      _Also registered with `Wormhole.expose()` in `main.js` for REST access._
- [x] Map only the **bare-minimum** fields we show (read-only):
      `id`, `subject`, `project {id,name}`, `status {id,name}`, `assignedTo {id,name} | null`.
      _No due date, tracker, or priority in v1. Shaping via `redmine-issues.js`._
- [x] Frontend `redmineApi.issues.list(scope)` + `RedmineIssue` type.
- [x] **View switcher**: replace the `/app/tickets` h1 with a heading dropdown —
      **"Tickets v1"** (current view, unchanged) / **"Redmine Tickets"** (this view).
      Suppress the static registry title for the tickets route so the feature owns
      the heading + `view` state; `TicketsPage` stays always-mounted.
- [x] Keep the UI visually the same. **"New Ticket" is disabled with a "Read only"
      popover** in the Redmine view. **Search works** client-side (id + subject + project).
- [x] **Scope toggle "Assigned to me" / "All"** drives the _server fetch_ (`assigned_to_id=me`
      vs. all). This is **not** redundant with the header assignee filter: the toggle bounds
      _what is fetched_; the assignee filter refines _what is loaded_. Header assignee-filter
      options are derived from the **assignees present in the fetched issues** (no Redmine
      users API needed — sidesteps whether the key can list team members).
- [x] Each row links out to the Redmine issue URL (`{baseUrl}/issues/{id}`, new tab).
- [x] Loading / empty / **"not connected"** states on the Redmine Tickets view
      (not-connected → card linking to Settings). This satisfies M1's deferred
      "connection status on the tickets page" item.
- [x] **Caching (decided):** fetch-on-view + a manual **"Refresh"** button + a small
      in-memory (session) cache keyed by scope so toggling views doesn't refetch every
      time; refetch only on scope change or Refresh. **No server-side cache** in v1.

**Done when:** a connected user can switch to "Redmine Tickets" and see their assigned
Redmine issues (toggle to "All"), search them, and click through to Redmine — without
opening Redmine, and without altering the existing "Tickets v1" view.

---

## Milestone 2.1 — Replace the view switcher with one unified ticket table

M2's heading dropdown forces the user to _choose a system_ before they can see their work.
Retire it: **source becomes a column and a filter, not a mode.** One table shows Huddle
tickets and Redmine issues together, and the layout must absorb a third source (GitHub,
Jira, …) as **one new file + one registry entry** — no changes to the table, the filter bar,
or the page.

**Decision reversal (recorded deliberately):** M2 decided _"we do not build a generic
pluggable 'ticket source' abstraction (YAGNI/KISS)"_. With a second source now live and a
third anticipated, that call is reversed — the abstraction has earned its keep. What M2
decided still holds, though, and is **not** reversed: Redmine issues are **never adapted
into the core `Ticket` collection**. Normalization happens at the **read/adapter layer
only**; nothing about a source is persisted (Core Model Data Discipline).

### Decisions

- **Scope:** the list shows the **current team's Huddle tickets + the signed-in user's
  Redmine issues**. The two sources genuinely have different scoping models (team-scoped vs.
  personal-key-scoped) and this is the honest union of what each can supply.
- **Row identity:** `` `${sourceId}:${id}` `` — composite, client-side only, never stored.
- **Status (revised during implementation):** the page already had GitHub-style
  **Open / Closed tabs**, and that _is_ the canonical bucket — no separate taxonomy was
  invented. Each adapter supplies a single cross-source fact, `status.isClosed`, which
  drives those tabs; the row `Badge` always renders the **native** label, and the Status
  filter lists native values **grouped by source**. Redmine supplies `is_closed` on the
  issue status, so its statuses need no name-matching guesswork.
  _(The original plan proposed a four-bucket `open`/`in-progress`/`blocked`/`done` model.
  Dropped: the existing tabs already covered it, and the extra vocabulary earned nothing.)_
- **Redmine rows stay read-only — with one exception:** no action that would _write to
  Redmine_ renders. `capabilities.trackTime` is reserved for M3's per-row timer entry point
  (starting a timer is a TimeHuddle write, not a Redmine write) and ships as **false** in
  M2.1, so the row cannot offer a timer the backend cannot start. Clicking the title opens
  `{baseUrl}/issues/{id}` in a new tab — the internal `/app/tickets/:id` detail route only
  understands Huddle ids.
- **Layout: a `Table`.** The unified view is a sortable, paginated `@mieweb/ui` `Table`.
  Both previous layouts are gone: the standalone Redmine view's table _and_ the Huddle
  GitHub-style `<ul>` row list.

  _Two earlier positions were superseded and are recorded so the reasoning is not relitigated:_

  1. _The first plan said `Table` at `md+` with a `Card` list below `md`._
  2. _That was then reversed to "keep the `<ul>` row list", on the grounds that ticket rows
     are not tabular and that a table would need a second mobile renderer._

  _Both are now overridden by an explicit product decision: a table with columns, per-column
  sorting, row selection and pagination, scrolling horizontally on small screens rather than
  wrapping. The mobile `Card` renderer is **not** built — narrow screens get the horizontal
  scroll that `Table`'s `responsive` wrapper already provides, which is the accepted
  trade-off for a single row implementation._

- **Why `Table` and not DataVis NITRO.** The `Table` docs steer grid use cases to NITRO
  (`@mieweb/datavis`) and call hand-rolling sort/filter/selection on a plain table "out of
  policy". NITRO was evaluated and rejected for **this** milestone:

  - it pins `@mieweb/ui: =0.6.1-dev.148` against the app's `0.7.3`, so it cannot dedupe —
    the bundle would carry **two copies of the UI library** and two sets of React contexts;
  - it is currently a **devDependency** and would need promoting to a runtime dependency;
  - it windows via **show-more/limit**, which conflicts with the pager controls this
    milestone requires;
  - it needs a wcdatavis `ViewInstance`, a heavier integration than the data here warrants.

  What we build instead stays **inside** the documented envelope, which is narrower than the
  headline suggests: `TableHead`'s `sortable`/`sortDirection`/`onSort` is a **real supported
  feature** that emits `aria-sort`; selection is explicitly _"the host's responsibility"_;
  and the docs list `Pagination` under _"composes with"_.

  **Policy deviation, taken knowingly (M2.2).** Filtering was first kept in a chip bar
  precisely so we stayed inside that envelope. It has since moved into **per-column header
  menus**, which the docs name as the one thing that is out of policy. Accepted because the
  alternative — NITRO — would ship a second copy of `@mieweb/ui`. **Revisit when
  `@mieweb/datavis` tracks the app's `@mieweb/ui` version.**

- **Columns:** select · Title · Issue # · Source · Status · Priority · Assignees · Project ·
  Updated · actions (⋮). Everything except select, Assignees and actions is sortable
  (Assignees is multi-valued, so it filters but does not sort). Source, Status, Priority,
  Assignees and Project each carry a filter menu in the header.
- **No filter chip bar.** `TicketFilterBar` is deleted. Search stays in the top bar next to
  a **`Switch`** for open/closed (replacing the tabs) and a "Clear filters" button that
  appears only when a filter is active. The open/closed counts the tabs used to show are
  kept as muted text beside the switch.
- **Header composition constraint.** `TableHead`'s `sortable` prop wraps its children in a
  `<button>`, so a filter trigger passed as children would nest a button inside a button.
  `TicketColumnHeader` therefore renders the sort control and the filter trigger as
  **siblings** and supplies `aria-sort` itself — `TableHead` spreads `...props` after its
  own `aria-sort`, so ours wins.
- **Redmine scope:** defaults to **all** issues the key can see. "Assigned to me" is now the
  Assignee column filter rather than a separate fetch scope, so the M2 scope toggle is gone.
  _Note: this is a **server** fetch, not a client filter — a large Redmine instance means a
  larger payload on load._
- **Selection:** a leading checkbox column with a **tri-state** select-all header
  (`Checkbox indeterminate`). Select-all applies to the **current page only**, matching what
  the user can see. No bulk action is wired yet — the column exists for a future feature.
- **Pagination, not scrolling:** the table fills the available height and pages; the row
  area never scrolls vertically. `useAutoPageSize` measures the row area with a
  `ResizeObserver` and reports how many rows fit, so a tall display shows more rows and a
  short one fewer. Page **clamps** rather than resets when the area shrinks, and resets to 1
  when the search, filters or Open/Closed tab change.
- **Timer moved off the row.** The per-row timer toggle is gone; **Start/Stop timer** now
  lives in the row's ⋮ menu, gated on `capabilities.trackTime`. (Its eventual home is
  elsewhere — see M3.)
- **Page width:** `<AppPage fill width="full">`. The page originally rendered in `AppPage`'s
  default `max-w-4xl` reading column, which squeezed the table into roughly half the
  available width. `AppPage` gained a `full` (`max-w-none`) option alongside `content` and
  `wide` so a wide table can use every pixel.
- **Components:** `@mieweb/ui` only — `Table`, `TableHead` (sorting), `Checkbox`
  (selection), `Switch` (open/closed), `Badge`, `Pagination`, `Button`, `Dropdown*`, `Text`.
  The row's hand-rolled `<span>` badges became `Badge`; low and unrecognized priorities use
  the `outline` variant because `secondary` is low enough contrast to read as plain text.
  The existing shared `src/ui/EmptyState.tsx` is kept.
- **Still client-side:** filtering, sorting and paging all happen in the browser. The
  backend exposes no sort/filter/paginate params today and M2.1 does not add any.
- **Redmine scope preserved:** M2's "Assigned to me / All" toggle survives as a **Redmine**
  filter chip, shown only when Redmine actually contributed rows.

### Prerequisite — dependency drift (blocking, found during implementation)

- [x] `node_modules` held `@mieweb/ui@0.6.1` while `package.json`/`package-lock.json`
      pinned `0.7.3`, so every API check was being made against a version CI does not
      install. Fixed with `npm ci`; the `Badge` and `Table` APIs turned out identical
      across the two, and the full gate was re-run against `0.7.3`.
      _Re-check this before trusting any `@mieweb/ui` API reading._

### Backend prerequisite (blocking)

- [x] `redmine-issues.js` `toIssue()` additionally maps `created_on` → `createdAt`,
      `updated_on` → `updatedAt`, `priority`, `tracker`, and preserves `status.is_closed`
      as `status.isClosed`. **Without timestamps a merged list cannot be sorted
      chronologically at all**, and without `is_closed` Redmine rows cannot enter the
      Open/Closed tabs. M2 dropped these deliberately; the file's header comment now
      records why that changed. A missing `is_closed` (older Redmine) is treated as open
      rather than guessed from the status name.
- [x] `meteor-backend/tests/redmine-issues.test.ts` fixtures and assertions extended.
- [x] `RedmineIssue` widened in `src/lib/api.ts`, with a `RedmineIssueStatus` carrying
      `isClosed`.

### Source adapter layer — `src/features/tickets/sources/`

The normalized shape every source is mapped into. `defineSource()` erases each adapter's
raw type so sources with different payloads can share one registry. There is no
`statusBuckets.ts` — the four-bucket model was dropped in favour of the single `isClosed`
fact (see Decisions).

```ts
interface UnifiedTicket {
  key: string; // `${sourceId}:${id}`
  sourceId: TicketSourceId;
  id: string;
  ref: string; // shown in the Issue # column
  title: string;
  container: { id: string; name: string } | null; // Huddle team | Redmine project
  status: { native: string; isClosed: boolean }; // native shown, isClosed filtered
  priority: { native: string; rank: number } | null;
  assignees: { id: string; name: string }[]; // namespaced per source
  createdBy: { id: string; name: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  externalUrl: string | null; // row links out instead of in
  externalRef: { url: string; label: string } | null;
  sharedWithTimeharbor: boolean; // Huddle-only; false elsewhere
  capabilities: SourceCapabilities;
}
```

- [x] `types.ts` — `UnifiedTicket`, `TicketSource`, `AnyTicketSource`, `TicketSourceId`,
      `SourceCapabilities`, `defineSource()`.
- [x] `huddleSource.ts` / `redmineSource.ts` — adapters over `ticketApi` and
      `redmineApi.issues.list`. `redmineSource` inherits the retired view's per-(user,
      scope) cache key.
- [x] **Interface kept extension-ready for M6.** `TicketSource` declares mutation
      (`create` / `update` / `delete`) as **optional** members guarded by `capabilities`,
      so M6 is an _additive_ implementation swap rather than a redesign. Deliberately not
      implemented here — only the seam. Concretely, M6's frontend reduces to rewriting
      `redmineSource.fetch()` to read from the DB and flipping its `capabilities` flags;
      everything above the adapter stays untouched.
- [x] `registry.ts` — the `TICKET_SOURCES` registry (the folder's anchor). Kept separate
      from `index.ts` so the hook can import it without a cycle.
- [x] `README.md` — "how to add a source" (Folder Philosophy).
- [x] `useUnifiedTickets.ts` — **source-partitioned** state
      (`Record<TicketSourceId, { items, loading, error }>`). Partitioning is not cosmetic:
      Huddle arrives via DDP push and Redmine via one-shot fetch, so a shared array would
      let a DDP update clobber the Redmine rows. Sources load via `Promise.allSettled` —
      one failing source shows a per-source error and keeps its last good rows, never an
      empty list. A source whose `isAvailable()` is false (Redmine not connected) is
      omitted silently, not errored.
- [x] Colocated unit tests: normalization, `isClosed` mapping, id namespacing, merge,
      partial failure, unavailable-source omission.

### UI

- [x] `TicketColumnHeader.tsx` — sort control + filter menu as siblings inside the `th`,
      with `aria-sort` supplied explicitly.
- [x] `TicketTable.tsx` — `Table` with per-column sort + filter headers, tri-state
      select-all, per-source error banner, `EmptyState` when empty.
- [x] `TicketTableRow.tsx` — `TableRow`/`TableCell`; actions gated on `capabilities` so
      Redmine rows never render dead controls. `Badge` for source, status and priority.
- [x] `ticketFilters.ts` — owns `TicketFilters`, the sentinels, and the pure option-derivation
      helpers (`statusOptions`, `priorityOptions`, `assigneeOptions`, `containerOptions`).
- [x] `useAutoPageSize.ts` — `ResizeObserver` on the row area, reports how many rows fit.
- [x] `FilterDropdown.tsx` — extracted from `TicketsPage`; now also accepts a custom
      `trigger` so headers can use an icon.
- [x] **`TicketFilterBar.tsx` deleted** — filters moved into the headers, open/closed became
      a `Switch`, "Clear filters" moved beside it.
- [x] `TicketsPage.tsx` — deleted `TicketsView`, `VIEW_LABELS`, the `<h1>` `Dropdown`
      switcher, the `view === 'redmine'` branch and the local filter `useState`s; added
      selection, paging and `width="full"`. **1981 → ~1100 lines.**
- [x] Fixed `useRefresh(refetch, pathname === '/app/tickets' && view === 'v1')` — the
      `view` guard is gone and refresh re-runs every source.
- [x] Moved `RedmineTicketsView.tsx` to `.attic/` with a header note explaining what
      superseded it and which behaviour `redmineSource` inherited.
- [x] Deleted the avatar-suppression workaround — it only existed because the old `<ul>`
      rows sat under the portaled filter menu.
- [x] A11y: `aria-sort` on every sortable header (supplied by `TableHead`),
      `aria-live="polite"` on the result count, `aria-label` on every filter control and
      on both row and select-all checkboxes.

### Tests

- [x] `tests/e2e/pages/TicketsPage.ts` — switcher locators dropped; table-row,
      source, column-sort, select-all and pagination locators added.
- [x] `tests/e2e/tickets/unified-table.spec.ts` — no switcher, expected columns,
      per-row source tagging, source isolation, header sorting + `aria-sort`, tri-state
      select-all, no vertical scroll, timer-in-menu, no error when Redmine is unlinked.
- [x] `tests/e2e/tickets/tickets.spec.ts` — filter-chip assertions updated.
- [ ] **Not yet run:** the Playwright suites need the local stack. Unit tests (182) and a
      production build both pass.
- [ ] `tests/e2e/realtime/ticket-timers.spec.ts` and `tests/e2e/timers/timer-deduplication.spec.ts`
      drive timers from ticket rows — they must be repointed at the ⋮ menu now that the
      per-row timer button is gone.

### Suggested PR split

1. Backend DTO fields + tests (independently mergeable, no UI impact).
2. Adapter layer + unit tests (inert until PR 3, zero user-visible change).
3. Unified table UI, switcher removal, e2e repair.

### Verification status

| Gate                         | Result                                 |
| ---------------------------- | -------------------------------------- |
| `npm ci` (drift fix → 0.7.3) | ✅                                     |
| `npm run typecheck`          | ✅                                     |
| `npm run lint`               | ✅                                     |
| `npm run format`             | ✅                                     |
| `npm run test:unit`          | ✅ 186 passing                         |
| `npm run build`              | ✅                                     |
| Playwright (`npm run test`)  | ⬜ not yet run — needs the local stack |
| Browser smoke test           | ⬜ deferred                            |

**Done when:** `/app/tickets` shows Huddle tickets and Redmine issues in one sortable,
filterable, paginated table with no view switcher anywhere; a user with no Redmine link
sees their Huddle tickets and no error; and adding a hypothetical third source requires
only a new adapter file and a registry entry.

### Follow-ups left open

- **Repoint the timer e2e specs** at the ⋮ menu (`ticket-timers.spec.ts`,
  `timer-deduplication.spec.ts`) — the per-row timer button they click no longer exists.
- **Confirm `ROW_HEIGHT` in `useAutoPageSize.ts`.** It is estimated at 57px from
  `TableCell`'s `p-4` plus a divider. If the real row height differs, the last row clips or
  a gap appears. Measure it once in the browser and pin the constant.
- **The ticket-details modal in `TicketsPage.tsx` is unreachable dead code** — nothing sets
  `detailsTicket`, and row menus navigate to `/app/tickets/:id` instead. Left in place to
  keep this diff scoped; delete it (or restore a path to it) separately.
- **Mobile is horizontal scroll, not a card layout.** Accepted trade-off; revisit if it
  proves unusable on a phone.
- **Revisit DataVis NITRO** once `@mieweb/datavis` tracks the app's `@mieweb/ui` version —
  it would replace the hand-rolled selection and give column menus for free.

---

## Milestone 2.2 — "My Board" personal priority view

A personal priority board layered on top of the unified table: select tickets on the
Tickets tab and move them to a second "My Board" tab, which renders the identical table UI
plus one extra column — a play button between the checkbox and Title columns — reserved for
starting a ticket timer directly from the row. **UI-only in this milestone**: the play button
is a static, always-disabled placeholder. Wiring it to actually start/stop a timer (even for
Huddle tickets, where the underlying mechanism already works via the ⋮ menu) is deliberately
left to **Milestone 3**, whose "Ticket table" entry point bullet below now covers both the
main table's ⋮ menu and this column.

### Decisions

- **Identity-only persistence (Core Model Data Discipline).** The new `my_board` collection
  stores `{ userId, sourceId, ticketId, addedAt }` — no title/status snapshot. Display fields
  are resolved by filtering the already-fetched unified ticket list against board membership
  at render time. A board entry whose ticket later disappears from that list (archived,
  deleted, out of the Redmine fetch window) simply doesn't render a row — no error.
- **Tabs, not a dropdown.** `@mieweb/ui`'s `Tabs`/`TabsList`/`TabsTrigger` replace the page's
  static `<h1>` (kept `sr-only` for a11y/test continuity). Same `/app/tickets` URL throughout
  — `activeView` is local component state, matching M2.1's decision to retire the
  heading-dropdown pattern rather than reintroducing it for a second view.
- **`useTicketTableView` extraction.** The page's inline search/filter/sort/paginate/select
  pipeline is now a hook, instantiated once per tab (`allTickets`, and the board subset)
  so switching tabs never resets or leaks the other tab's state. This is the reuse M2.1's
  single-table refactor didn't need yet — a second table view is what earns the hook.
- **Bulk-action bar.** Shown once `selectedKeys.size > 0`: "N selected" · Deselect all ·
  **Delete** (functional — loops the existing single-delete method over the eligible
  selection; no new bulk Meteor method) · **Archive** and **Close Issues** (**static,
  always-disabled placeholders** — no backend or model support exists yet; reserved for a
  later milestone) · a contextual primary button, **Move to My Board** on the Tickets tab or
  **Remove from My Board** on the My Board tab.
- **`TimerToggleButton` reuse.** The play-button column renders the existing (previously
  unused) `src/ui/TimerToggleButton.tsx` as-is, always `disabled`, `isRunning={false}`, with a
  tooltip explaining the feature lands in a later milestone. No new button component.

### Backend

- [x] `MyBoard` collection (`meteor-backend/server/collections.js`) + a compound unique index
      on `{ userId, sourceId, ticketId }` (`meteor-backend/server/my-board.js`), enforcing
      "one board row per (user, ticket)" and making `addMany` an idempotent upsert.
- [x] Meteor methods `myBoard.list` / `myBoard.addMany` / `myBoard.removeMany`, modeled
      directly on `redmine.js`'s conventions (`requireIdentity`, plain `Meteor.methods`).
- [x] `Wormhole.expose` registration for all three in `meteor-backend/server/main.js`.

### Frontend

- [x] `myBoardApi` (`src/lib/api.ts`) — `list` / `addMany` / `removeMany`, same shape as
      `notificationApi`.
- [x] `useTicketTableView.ts` — extracted pipeline, instantiated as `ticketsView` and
      `boardView` in `TicketsPage.tsx`.
- [x] `TicketTable`/`TicketTableRow` gained an opt-in `showTimerColumn` prop. The main
      Tickets table passes nothing, so its markup and columns are unaffected.
- [x] `TicketBulkActionBar.tsx` — the bulk-action bar component, reused for both tabs.
- [x] `TicketsPage.tsx` — tabs, board membership state (`boardKeys`, optimistic
      add/remove, no refetch needed since entries are inert identity rows), generalized
      delete confirmation (`deleteIds: string[]` covers both single-row and bulk delete).

### Tests

- [x] `tests/e2e/tickets/my-board.spec.ts` — move/remove to board, the board's play button
      renders visible but disabled, the bulk-action bar's Delete/Archive/Close Issues/board
      buttons, and bulk delete via the (generalized) confirmation modal.
- [x] `tests/e2e/pages/TicketsPage.ts` — tab, bulk-action-bar, and timer-button locators.
- [x] Confirmed unchanged: `unified-table.spec.ts`'s `'starts a timer from the row menu, not
a row button'` test — the main Tickets table still never renders the timer column.
- [ ] **Not yet run against the local stack** (`compose.yaml`) — unit tests (186) and
      `typecheck`/`lint`/`format` all pass; Playwright needs the local stack to confirm.

**Done when:** a user can select tickets on the Tickets tab, move them to My Board, see the
identical table with an inert play-button column, move them back, and none of Delete
(functional) / Archive / Close Issues (static) reach beyond this milestone's stated scope.

---

## Milestone 3 — Start a ticket timer against a Redmine issue

Let a user track time against a Redmine issue using the **existing ticket-timer
mechanism** (WorkItems + Timers), the same one already used for internal tickets.
_(Details still to be finalized — see "Time-tracking integration" note below.)_

**Key change — source-aware `WorkItem` (decided):** the timer layer already stores
one `WorkItem` per (userId, ticket, date) with multiple start/stop `Timers` sessions.
Make it **source-aware** rather than building a parallel timer:
`source: 'internal'` → `ticketId` (existing), `source: 'redmine'` → `redmineIssueId`.
All session / net-hours math is reused unchanged. Redmine WorkItems are **personal
to the user's key** (no team-membership permission check).

**Two entry points (decided):**

- [ ] **Clock page**: a **"Redmine tickets" dropdown**, shown **only when a Redmine
      account is connected**, populated from `redmine.issues.list({ scope: 'mine' })`.
- [ ] **Ticket table**: a **"Start timer"** item in the row's ⋮ menu. M2.1 already ships
      this entry point, gated on `capabilities.trackTime`, which is **false** for Redmine
      until the source-aware `timers.createEntry` below exists — M3 flips that flag rather
      than adding new UI. _(M2.1 also removed the per-row timer button that Huddle rows
      used to carry; the timer lives in the ⋮ menu for both sources now.)_
- [ ] **My Board play button**: M2.2 shipped the column (between checkbox and Title) as a
      static, always-disabled placeholder. M3 wires it to the same `onToggleTimer` mechanism
      the ⋮ menu already uses — no new column, no new plumbing, just enabling what's there.
- [ ] Extend `timers.createEntry` (and title/link resolution) to accept a Redmine source
      and create/reuse a `source: 'redmine'` WorkItem.
- [ ] Handle "not connected" and "no assigned tickets" cases gracefully.

**Done when:** a connected user can start/stop a timer against a Redmine issue from either
the clock page dropdown or the ticket table, producing a normal TimeHuddle work-session tied
to that Redmine issue.

---

## Milestone 4 — Time tracking stays in TimeHuddle

All timing detail lives on the TimeHuddle side; Redmine only ever gets a total.

> **Which "time" syncs to Redmine (decided, do not conflate):** TimeHuddle has two
> independent notions of time — **System A**, the per-**team** shift clock
> (`ClockEvents`, `accumulatedTime` = shift span − meal breaks), and **System B**, the
> per-**ticket** timers (`WorkItems` + `Timers`, summed net seconds per ticket per day).
> **Redmine sync uses System B's per-issue-per-day total — never the shift total.**
> The shift clock stays a separate, team-level concept.

- [ ] Confirm the existing System B model captures what we need:
      start time, end time, and multiple sessions per (source-aware) work item per day.
- [ ] Compute **net worked seconds** per day = summed across all `source: 'redmine'`
      sessions for the same `redmineIssueId` on the same day (reuse `timers.getTicketTotal`).
- [ ] Add `redmineTimeEntryId` to the (Redmine) work record (idempotency key for sync).
- [ ] Add a per-team/user **default `activity_id`** (Redmine requires an activity;
      pick a sensible default, e.g. "Development", configurable later).
- [ ] Unit-check the hours math (breaks subtracted, multiple sessions merged correctly).

**Done when:** starting/stopping, taking breaks, and running multiple sessions produces one
correct net-hours total per ticket per day, entirely within TimeHuddle.

---

## Milestone 5 — Sync logged time back to Redmine

Push the computed hours to Redmine as a time entry (the only write in v1).

- [ ] `redmine-client.createTimeEntry` / `updateTimeEntry`:
      `POST/PUT /time_entries.json` with `issue_id`, `hours`, `activity_id`,
      `spent_on`, `comments`, using the caller's personal API key
      (so authorship is correct — no admin switch-user needed in v1).
- [ ] Sync trigger: on clock-out / day close, **upsert** one time entry per
      `redmineIssueId` per day: - if `redmineTimeEntryId` exists → `PUT` (update hours), - else → `POST`, then store the returned id.
- [ ] Round/format hours to what Redmine accepts (decimal hours).
- [ ] **Re-read after write** and confirm the hours match (Redmine can return
      `200` while silently ignoring a value); surface a sync error if they don't.
- [ ] Never create a new entry on every timer stop — always upsert by stored id.
- [ ] Retry/failure UX: mark a session "sync failed" with a manual "Retry sync" action.

**Done when:** a full day of clock/timer activity produces exactly **one** Redmine time
entry per ticket per day, with correct hours and no duplicates on retry.

---

## Milestone 6 — Persistence & two-way issue sync (deferred, NOT in v1)

Captured here so the decision is on the record. The ambition is to store Redmine issues in
TimeHuddle's own database (not just a browser cache) and perform full CRUD on Redmine
issues from Huddle. **This is deliberately excluded from v1**, including from M2.1.

**Why it is deferred, not merely unscheduled:** it is a different architecture, not a
larger version of M2.1. M2.1 merges two read paths in the browser. M6 reverses foundational
decisions from M1 and M2, and none of it is required by this plan's stated goal (don't open
Redmine to see your tickets or to log time). M5 is the payoff and is still unbuilt.

**Deferring does not make M6 bigger.** Roughly 90% of M6's cost is backend (ACL model,
polling/webhook infrastructure, conflict resolution, sync state machine, custom-field
discovery) and is entirely insensitive to ordering. The frontend cost is _reduced_ by
shipping M2.1 first: the adapter layer is the seam M6 would otherwise have to build before
it could start. After M2.1, M6's frontend work is rewriting `redmineSource.fetch()` to read
from the database and flipping its `capabilities` flags \u2014 the list, filter bar, row, status
bucketing, and registry are unaffected. And because M2.1 persists nothing, no migration
debt accrues in the meantime.

**Start the decision early even though the code is deferred.** Blocker 1 below is an
organizational question (will the Redmine instance owner issue an admin/service account?),
not an engineering one, and it has a long lead time. Ask it now; it gates M6 regardless of
when M6 is scheduled.

### Blockers that must be resolved before any M6 code

1. **Per-user API keys vs. a shared store — the fork in the road.** M1 stores a _personal_
   key per user, and M5 depends on it ("authorship is correct — no admin switch-user
   needed"). Each key sees a different subset of issues under Redmine's project+role
   permissions, including private issues and private notes. So a persisted issue collection
   has no safe shape:
   - **shared collection** → broken access control (OWASP A01); every row would need a
     per-user visibility set, recomputed on permission changes TimeHuddle cannot observe;
   - **per-user copies** → N× duplication, each drifting independently;
   - **admin key + `X-Redmine-Switch-User`** → the only clean option, but it needs an admin
     API key and Redmine-admin cooperation, and it **reverses M1's personal-key premise**.

   Requires an explicit decision from the owner of the Redmine instance.

2. **No native webhooks.** Stock Redmine has no outbound webhook; it needs a plugin or
   polling (`GET /issues.json` filtered on `updated_on`) per user, per interval. Polling
   cost scales linearly with connected users.
3. **Conflict resolution.** Redmine remains authoritative — other people, workflows, and
   plugins edit issues there, so a persisted copy _will_ drift. The REST API offers no
   usable optimistic locking for issues, so concurrent edits are last-write-wins and clobber
   silently. A drift-detection/reconciliation job (currently listed as out of scope) becomes
   mandatory.
4. **Custom fields are admin-only.** `GET /custom_fields.json` requires admin, so a normal
   user key **cannot enumerate which custom fields are required** on a project. Generic
   issue _creation_ is not reliably solvable with personal keys alone.
5. **Workflow-gated status transitions.** Allowed transitions depend on tracker + role +
   workflow, per issue. An edit form needs `GET /issues/:id.json?include=allowed_statuses`
   (Redmine 5.0+) per row, plus `/trackers.json` and `/enumerations/issue_priorities.json`.
   Verify availability against the target Redmine version.
6. **Data residency.** Persisting Redmine-ACL-governed content (subjects, descriptions,
   notes) into TimeHuddle's Mongo is a governance decision, not an implementation detail.
7. **Contradicts recorded decisions.** M2: _"Future Redmine issue CRUD … extends
   `redmine.issues._`— never the core`Ticket` collection."\* M2.1 holds the same line.

### Recommended intermediate step, if the real driver is durability

If the motivation is offline/mobile support and faster loads (reasonable — this ships as a
Capacitor app), a **per-user, server-side, read-through cache** delivers most of the value
with none of the above:

- [ ] `redmine_issue_cache` keyed by `userId`, populated **only** by that user's own key,
      TTL'd, never written back.
- [ ] No ACL leakage (scoped to the fetching key), no conflict resolution (Redmine stays
      authoritative), no admin key required.
- [ ] Composes cleanly with M2.1 — the `redmineSource` adapter reads the cache instead of
      going straight to Redmine; nothing else changes.

**Write CRUD is the expensive half, and the stated goal does not need it.**

---

## Time-tracking integration — affected surfaces

Because Redmine time reuses the existing **source-aware `WorkItem`** (M3) rather than a
parallel mechanism, every surface that renders a work item's **title** or links to
`/app/tickets/{id}` must branch on `source`. Resolve title + row-link **once** in the
`toPublicEntry` / `getTicketTitleMap` layer so consumers get it for free:
`internal` → internal `Ticket` title + `/app/tickets/{id}`; `redmine` → Redmine subject +
`{baseUrl}/issues/{id}` (external).

Surfaces to update:

- [ ] **WorkPage** (`/app/work`) — Redmine entries appear in the day/week timesheet;
      title comes from Redmine (not `getTicketTitleMap`, which would show "Unassociated
      Timer" for a numeric id), row links out to Redmine.
- [ ] **ClockPage** — running-ticket badge (`useRunningTicket`) resolves Redmine title
      and links out to Redmine instead of an internal detail page.
- [ ] **Dashboard / PersonalTimesheetPanel / TimesheetRow** — Redmine entries fold into
      per-day items and totals with correct title/link.

**Team-scoped surfaces — excluded for the MVP (decided):** Redmine WorkItems have no
`teamId`, so they are intentionally **left out** of team-scoped features for v1 (accepted
gaps, revisit later):

- `timers.getTeamRunning` (team "who's working on what" live view).
- `notifyTimesheetAdmins` (timesheet-admin notifications).
- `timers.getUserWorkSummary` (Huddle work-summary tags).

Also out of scope for now: attaching Redmine issues in the Huddle composer / `TicketPicker`,
and any Redmine issue detail page (issues are read-only; link out instead).

---

## Cross-cutting / definition of done

- [ ] API keys encrypted at rest; never logged; never sent to the client after save.
- [ ] Every Redmine write is confirmed by a follow-up read (no blind trust in HTTP 200).
- [ ] Graceful handling of: not-connected, invalid key, Redmine unreachable, no tickets.
- [ ] Config: `REDMINE_BASE_URL` + default `activity_id` documented, not hardcoded.
- [ ] Manual end-to-end test against the local Redmine instance
      (`compose.yaml`) using a seeded user from `accounts.md`:
      connect → see assigned tickets → clock in on a ticket → work with a break →
      clock out → verify a single correct "Spent time" entry appears in Redmine.

## Suggested build order

1. Milestone 1 (connection) — nothing works without it.
2. Milestone 2 (read issues) — proves the key + read path.
3. Milestone 3 (clock dropdown) — ties a session to an issue.
4. Milestone 4 (timing math) — mostly TimeHuddle-internal.
5. Milestone 5 (write-back) — the payoff, last because it depends on 1–4.
6. Milestone 2.1 (unified table) — **UI-only and independent of 3–5**, so it can run in
   parallel or slot in wherever convenient. It is numbered 2.1 because it supersedes M2's
   view switcher, not because it blocks anything.
7. Milestone 2.2 (My Board) — **UI-only and independent of 3–5**, same as 2.1; built on top
   of it. Its play-button column is inert until M3 wires it up.
8. Milestone 6 (persistence / two-way sync) — deferred; do not start before its blockers
   are resolved and M5 has shipped.
