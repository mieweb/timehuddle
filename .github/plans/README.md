# TimeHuddle — Product Plans

> Some of these documents are **exploratory drafts**. Not all is approved for
> implementation or represents a commitment. Plans exist to think through
> architecture and feature direction before writing code.

---

## What These Plans Are For

As TimeHuddle grows from a time tracking tool into a team operations platform,
some decisions made early (data models, org hierarchy, event architecture)
become very expensive to change later. These plans exist to think those
decisions through *before* they become constraints.

Planning docs should stay high-level by default: problem, options, tradeoffs,
and acceptance criteria. Avoid deep implementation details until a direction is
approved.

---

## The Platform Vision

At full expression, these plans describe a transition across at least three personas:

### Engineers
Already has: clock in/out, tickets, messages, notifications, basic profile.

With these plans they gain:
- A **meeting entry** for standups and future ceremonies, pre-filled with their
  work context so they review and respond instead of starting from a blank form
- **Capacity awareness** — log time off, see available hours for the week
- A **discoverable profile** — clickable from the team member list and from chat
- **Mobile** access via PWA or native app

A member goes from "time tracking tool" to "I show up, my work is already
contextualized, and I'm visible to my team."

### Scrum Master
Currently has almost nothing purpose-built for them. With these plans they get:
- **Meetings / standups** — run structured team ceremonies with pre-populated
  participant entries and future room for broader meeting types
- **Team capacity timeline** — who has 32 hrs available, who is on PTO, who is
  already overloaded before sprint planning starts
- **Reports** — ticket summary, member activity, standup blocker patterns across
  a sprint
- **AI (future)** — sprint capacity advisor recommends a sustainable story point
  target based on available hours and historical velocity

A scrum master goes from running standups in a Google Doc and guessing at
capacity, to a purpose-built cockpit for ceremonies and sprint planning.

### HR / Payroll / Finance
Currently has no presence in the system at all. With these plans they get:
- **ADP CSV export** — payroll hours flow out of the system directly, no manual
  timesheet collection or re-entry
- **Timesheet export** — full hours-per-member-per-period in Excel-friendly CSV
- **Org layer** — one place to manage all employees across all teams: headcount,
  billing, member directory
- **Time off records** — self-service entries with team admin visibility;
  foundation for a PTO approval workflow later
- **Google Workspace SSO** — new hires get access automatically; departing
  employees lose it when removed from the directory
- **Utilization reports** — data for performance reviews, resourcing decisions,
  billable hours tracking

HR goes from zero visibility to a payroll pipeline, member directory, time off
records, and utilization data — without touching a developer.

### Additional Personas

Beyond the three primary personas above, the research also points to a few
adjacent audiences worth keeping in view:

- **Managers** — want quick visibility into work, momentum, and blockers
- **Team lead / engineering lead** — cares about coordination, workload, and delivery risk
- **FIRST Robotics coach / lead mentor** — similar needs around coordination, hour tracking, and documentation

---

## The Activity Feed — The Connective Tissue

**Issue**: [#14 — Activity Feed — unified event log for user/team activity](https://github.com/mieweb/timehuddle/issues/14)

The activity feed is arguably the most important foundational piece across all
these plans, and the core plumbing now exists. It is a single `activities`
MongoDB collection that features write to via `emitActivity()`. Clock in,
ticket created, meeting submitted, time off logged, member joined — all become
typed, normalized events in one place.

That same underlying event stream should power more than a plain log table.
On the team-facing side of a user's profile, it can drive a richer activity
feed UI that shows a higher-level narrative of what the person has been doing.
That is not a separate system or a second source of truth. It is the same
activity data, presented with more context, grouping, and visual affordances
for teammates.

This matters for the plans here because:

- **Reporting** aggregates activity events — the richer the feed, the richer the
  reports
- **Profiles** can render a richer teammate-facing activity feed without adding
  a separate activity model
- **Meetings / standups** can pre-populate participant entries by scanning
  recent activity events rather than querying multiple collections
- **AI** has one place to read from rather than joining clock, ticket, meeting,
  and capacity collections independently
- **Dashboard widgets** can be powered by activity streams without bespoke
  queries per widget
- **Org-level audit logs** (future HR/compliance need) are trivially built on
  top of an existing event log

The activity feed is a high-leverage investment that makes every other plan
cheaper to build. [Issue #14](https://github.com/mieweb/timehuddle/issues/14)
captured the foundational work; the next opportunity is to keep building on that
same event stream instead of creating feature-specific activity views with their
own storage and logic.

---

## The Architectural Bets

Underneath all of these plans, a few structural decisions show up repeatedly:

| Decision | Why it matters |
|----------|---------------|
| **Add the org layer early** | Retrofitting org scoping onto a mature codebase is expensive. Even a minimal org in the DB (no UI yet) future-proofs every query. |
| **Ship personal org first** | Unblocks social signup and namespace identity now, while deferring full multi-org/admin complexity until later phases. |
| **Clean, typed event data** | The activity feed, custom fields, and meeting responses are only as useful as the structure of their data. Schemaless blobs make reporting and AI hard. |
| **Reports and exporters are separate** | Reports decide *what* data, exporters decide *what format*. The same timesheet report powers the UI table and the ADP CSV file. |
| **Custom fields as a shared primitive** | Meeting questions, ticket metadata, and capacity tags all use the same field schema system — one implementation, not three. |

---

## Plan Index

| File | What it covers |
|------|---------------|
| [organizations.md](./organizations.md) | Org hierarchy, SSO, Google Workspace, billing |
| [meetings-standups-basics.md](./meetings-standups-basics.md) | Dynamic team meetings model, with standups as the first meeting type |
| [team-capacity.md](./team-capacity.md) | Availability, time off, blocked time, timeline view |
| [custom-fields.md](./custom-fields.md) | Flexible data model for standups, tickets, and beyond |
| [projects.md](./projects.md) | Higher-level containers for grouping work, reporting, and timer rollups |
| [tasks.md](./tasks.md) | Smaller work units that can sit alongside or beneath tickets and projects |
| [reporting.md](./reporting.md) | Report definitions, UI, dashboard widgets, AI summaries |
| [exporters.md](./exporters.md) | CSV, timesheet, ADP payroll exporter architecture |
| [timers.md](./timers.md) | Work/timer data model, sessions, and timesheet behavior |
| [profiles.md](./profiles.md) | Lightweight profile considerations like timezone handling |
| [mongoose-data-integrity.md](./mongoose-data-integrity.md) | Backend schema, validation, and migration direction |
| [mobile.md](./mobile.md) | PWA, Capacitor, React Native path post-Meteor migration |
