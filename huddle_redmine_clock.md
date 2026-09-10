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
- Add a **"Redmine Tickets" view** to the tickets page (**read-only issues, one-way Redmine → TimeHuddle**), switched from the existing "Tickets v1" view via a heading dropdown.
- Redmine Tickets view has a **scope toggle "Assigned to me" / "All"** (drives the fetch) plus a working search.
- Start a **ticket timer against a Redmine issue** from the clock page dropdown or a "Start working" button on the Redmine view — reusing the existing source-aware ticket-timer mechanism (not the team shift clock).
- All timing logic (start/end, breaks, multiple sessions) lives in TimeHuddle.
- Push the **summed hours** for a work session back to Redmine as a time entry.

**Explicitly out of scope (defer)**
- Creating/editing Redmine issues from TimeHuddle (no write-back of tickets).
- Two-way ticket sync of any kind.
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
- [x] Meteor method `redmine.connect(apiKey)`:
      - call `GET /users/current.json` with that key to validate,
      - on success, upsert a `redmine_links` row for the current user,
      - on failure, return a clear "invalid key / unreachable" error.
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

- [x] `redmine-client.listIssues(apiKey, { scope, limit, offset })`:
      - assigned to me → `GET /issues.json?assigned_to_id=me`,
      - all (visible to the key) → `GET /issues.json` (paginate via `limit`/`offset`).
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
- [x] **Scope toggle "Assigned to me" / "All"** drives the *server fetch* (`assigned_to_id=me`
      vs. all). This is **not** redundant with the header assignee filter: the toggle bounds
      *what is fetched*; the assignee filter refines *what is loaded*. Header assignee-filter
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
- [ ] **Redmine Tickets view (M2)**: a per-row **"Start working on this ticket"** button,
      mirroring the timer affordance the "Tickets v1" list already has. _(This is the one
      write-capable control on the otherwise issue-read-only view; it needs the source-aware
      `timers.createEntry` below to exist — may be pulled forward from M2.)_
- [ ] Extend `timers.createEntry` (and title/link resolution) to accept a Redmine source
      and create/reuse a `source: 'redmine'` WorkItem.
- [ ] Handle "not connected" and "no assigned tickets" cases gracefully.

**Done when:** a connected user can start/stop a timer against a Redmine issue from either
the clock page dropdown or the Redmine Tickets view, producing a normal TimeHuddle
work-session tied to that Redmine issue.

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
      `redmineIssueId` per day:
      - if `redmineTimeEntryId` exists → `PUT` (update hours),
      - else → `POST`, then store the returned id.
- [ ] Round/format hours to what Redmine accepts (decimal hours).
- [ ] **Re-read after write** and confirm the hours match (Redmine can return
      `200` while silently ignoring a value); surface a sync error if they don't.
- [ ] Never create a new entry on every timer stop — always upsert by stored id.
- [ ] Retry/failure UX: mark a session "sync failed" with a manual "Retry sync" action.

**Done when:** a full day of clock/timer activity produces exactly **one** Redmine time
entry per ticket per day, with correct hours and no duplicates on retry.

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
