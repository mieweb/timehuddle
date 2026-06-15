# TicketView

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

Huddle has tickets, but the team's ticket organization still depends on a
GitHub project board.

That creates a split workflow similar to the standup problem:

- Huddle may hold ticket, time, and meeting context
- GitHub Projects holds the visual organization of the work
- standups and planning discussions still depend on looking at the board in a
  separate tool

If Huddle is meant to replace the Google Doc workflow around standups and
team coordination, it also needs a clear answer for the board-shaped view of
tickets that the team already uses.

The important constraint is that a board view is not the same thing as a new
ticket model. The source of truth should remain the ticket system. TicketView is
about organizing and presenting tickets, not inventing another work object.

---

## Product Principle

TicketView should behave like a reusable presentation and organization layer for
tickets.

That means:

- one ticket record should not be duplicated into multiple models
- the same ticket can appear in a standalone board view or inside another
  workflow such as standup or sprint planning
- views should be attachable to other contexts without losing the ability to be
  useful on their own
- the first version should aim closer to GitHub Projects than to a full Jira
  replacement

The mistake to avoid is turning TicketView into a second ticketing system.

---

## Core Idea

A **TicketView** is a saved way to organize, filter, and display tickets.

It can be used in two modes:

1. **Standalone mode**
   - a team opens a ticket board or list directly to plan and organize work

2. **Attached mode**
   - a standup, sprint-planning session, project, or report references a
     specific TicketView so the same work context is visible inside that flow

The key idea is reuse. The same ticket organization should not need to be
rebuilt separately for standup, planning, and general board management.

---

## Why This Relates to Standups

The current standup workflow includes live review of each team member's open
tickets and relies on GitHub Projects for organization.

That suggests two product needs:

- the standup page should show ticket context in the same organizational shape
  the team already uses
- that board or grouping model should also be available outside standup as a
  normal team work view

Standup should consume TicketView. It should not own ticket-board behavior.

---

## What TicketView Likely Needs

Even in a first version, a TicketView likely needs:

- a name
- a team association
- a display mode: board, list, or compact grouped list
- filters
- grouping rules
- sort rules
- visible fields or columns
- optional attachment to another context such as a standup template or project

Possible grouping rules:

- status
- assignee
- priority
- sprint
- project
- custom field later

This keeps TicketView focused on how tickets are shown rather than what tickets
are.

---

## Standalone vs Attached Use

### Standalone

In standalone mode, TicketView should work as a team board or planning surface:

- browse current tickets
- move work between visible states if the chosen grouping supports it
- filter to one assignee, sprint, project, or status
- review workload and progress

### Attached

In attached mode, TicketView should provide ticket context inside another flow:

- a standup shows each member's tickets in the familiar grouping
- a sprint-planning workflow can reference a planning-specific view
- a project detail page can reference a project-specific ticket view

The attached mode should feel embedded, not like leaving the current workflow.

---

## Relationship to Existing Plans

| Plan | Relationship |
|------|--------------|
| **meetings-standups-basics.md** | Standups should consume ticket-board context without owning board management |
| **projects.md** | TicketView may group or filter tickets by project |
| **tasks.md** | Task categories may become filterable fields in the view later |
| **custom-fields.md** | Custom fields may eventually drive extra columns or grouping options |
| **reporting.md** | Saved views may inform dashboard widgets or reporting slices |

---

## Reasonable First-Version Scope

The first useful TicketView should stay narrow:

1. Define a team-level saved view for tickets.
2. Support at least one familiar visual mode: board or grouped list.
3. Allow simple grouping, filtering, and sorting.
4. Allow a standup template or standup run to reference one TicketView.
5. Show the TicketView alongside standup entries without forcing board-editing
   complexity into the standup workflow.

That is enough to validate whether the team can rely less on GitHub Projects
without trying to rebuild every board feature at once.

---

## Explicit Non-Goals for V1

TicketView should not initially try to be:

- a full GitHub Projects clone
- a new ticket database
- a dependency graph
- a roadmap or gantt tool
- a separate permissions system from teams
- a mandatory wrapper around all tickets

It should begin as a saved organizational view over the existing ticket model.

---

## Data Model (Rough)

```typescript
interface TicketView {
  id: string;
  teamId: string;
  name: string;
  mode: 'board' | 'list' | 'grouped_list';
  filters: TicketFilterDefinition[];
  groupBy?: 'status' | 'assignee' | 'priority' | 'project' | 'sprint';
  sortBy?: TicketSortDefinition[];
  visibleFields: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt?: Date;
}

interface TicketViewAttachment {
  id: string;
  ticketViewId: string;
  entityType: 'standup_template' | 'standup_run' | 'project';
  entityId: string;
  displayMode?: 'embedded' | 'linked';
}
```

The ticket remains the source of truth. TicketView is only saved presentation
state plus optional attachments.

---

## Open Questions

These should be answered before implementation planning:

1. Which GitHub Projects behaviors matter most to preserve first: columns,
   filters, sorting, field visibility, drag-and-drop, or saved slices?
2. Should TicketView be editable from inside standup, or only visible there?
3. Does the team need one canonical board, or multiple saved views per team?
4. Which ticket fields already exist in Huddle and which still depend on
   GitHub metadata?
5. Should TicketView attachments be template-level, run-level, or both?

---

## Acceptance Criteria for a Future Real Plan

- TicketView is clearly defined as a reusable view over tickets, not a new work
  model
- standups can reference ticket-board context without absorbing board logic
- the first scope is small enough to test against GitHub Projects usage
- the relationship between TicketView, tickets, projects, and saved filters is
  written down before implementation starts
