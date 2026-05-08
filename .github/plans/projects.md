# Projects

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

TimeHuddle currently has teams, tickets, timers, and clock events, but no clear
container for grouping related work across a longer arc.

That gap starts to matter once teams want to answer questions like:

- which tickets belong to the same initiative?
- where should timer totals roll up besides the team itself?
- how do we separate ongoing support work from a focused delivery effort?
- how do we give leads a planning view without turning every team into one flat
  ticket list?

Teams are not enough for this. A team is an ownership boundary. A project is a
work boundary.

---

## Working Assumption

The safest stub assumption is:

- a **project** groups related work within a team
- projects are optional, not required for every ticket or timer
- tickets may belong to a project
- timer totals should be able to roll up from ticket to project without adding
  a second time-tracking system
- reporting, capacity, and standups may all want project context later

This keeps projects additive. They should organize work, not force a rewrite of
the current ticket and timer model.

---

## Product Principle

Projects should clarify work at the initiative level without replacing tickets
as the day-to-day execution object.

That means:

- tickets remain the core work item for tracking and timers
- projects provide grouping, status, dates, ownership, and reporting context
- projects should improve planning views before they become heavy process
  objects
- the first version should avoid portfolio-management complexity

The mistake to avoid is building a large PM system before proving that simple
work grouping solves a real problem.

---

## Relationship to Existing Work Models

Projects are most useful if they work with the current system rather than next
to it:

- **Teams** own projects
- **Tickets** can optionally belong to a project
- **Timers / TimeEntry / TimerSession** continue to attach to tickets; project
  totals are derived through ticket membership
- **Activity feed** can use project context to tell a more coherent story about
  progress over time
- **Reports** can summarize hours, ticket throughput, and blockers by project
- **Capacity planning** can answer "who is spending time on Project X this
  sprint?"

This preserves one source of truth for time while still allowing project-level
planning and reporting.

---

## What a Project Likely Needs

Even in a lightweight version, a project likely needs a small amount of stable
metadata:

- name
- team association
- optional description
- status
- owner or lead
- target dates or date range
- optional color / icon / display treatment
- optional custom fields later

That is enough to support grouping, filtering, and reporting without forcing a
full roadmap product.

---

## Reasonable First-Version Scope

If projects are introduced, the first version should stay narrow:

1. Create and edit projects within a team.
2. Allow tickets to optionally link to one project.
3. Show project context in ticket lists and ticket detail.
4. Roll ticket-based timer totals up to the project level in reports.
5. Add project filters to relevant team views.

That would already unlock clearer organization for current work without adding
dependencies, sub-project hierarchies, or complex planning workflows.

---

## Explicit Non-Goals for the Stub

This stub does **not** assume:

- cross-team portfolio management
- gantt charts or roadmap tooling
- task dependency graphs
- budget or billing workflow
- project-specific permissions distinct from team permissions

Those may matter later, but they are not required to justify a project concept
today.

---

## Open Questions

These questions should be answered before turning this into an implementation
plan:

1. Is a project always scoped to a single team, or can it span teams later?
2. Should tickets require a project in some workflows, or always remain
   optional?
3. Does project status reflect delivery state, reporting state, or both?
4. Should standups and reporting summarize by project automatically when ticket
   data is present?
5. Do custom fields belong on projects in v1 or only after the base model is
   proven?

---

## Acceptance Criteria for a Future Real Plan

- there is a clear definition of how projects differ from teams and tickets
- project time totals derive from existing timer data instead of duplicating it
- the model stays small enough to support reporting and planning without adding
  heavy process overhead
- open questions about scope, ownership, and reporting are written down before
  implementation starts