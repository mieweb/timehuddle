# Tasks

> **STATUS: IDEA** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

Huddle has tickets, timers, and clock events, but it does not yet have a
clean way to describe the **kind of work** someone is doing.

Examples:

- Development
- Design
- Call
- Book Keeping
- Support
- Planning

Today the product can usually tell **what ticket** someone touched, but not
always **what category of effort** that time represented.

That becomes limiting once teams want to answer questions like:

- how much time went to development versus meetings or calls?
- how much admin or bookkeeping work is consuming the week?
- which timers had no ticket but still represent legitimate work?
- how should reports summarize work beyond a flat ticket list?

Without a task category concept, those answers either disappear entirely or get
buried in freeform notes.

---

## Working Assumption

The safest stub assumption is:

- a **task** is a category or work type, not a checklist item
- tasks describe the nature of work being done
- tickets and projects describe the subject or container of work
- timers should be able to reference a task category without creating a second
  time model
- task categories should improve reporting and organization more than workflow

In this framing, "Development" and "Design" are tasks in the same sense that
"Bug" or "Feature" can be categories. They are labels for the kind of effort,
not independent work objects to complete.

---

## Product Principle

Tasks should classify work without competing with tickets, projects, or timers.

That means:

- tasks should behave more like categories than standalone records
- tasks should make timer rows and reports easier to understand
- tasks should work alongside tickets rather than replacing them
- the same timer system should remain the source of truth for time totals
- task names should be stable and intentional enough for reporting

The mistake to avoid is treating task categories as if they were a second work
item model.

---

## Relationship to Tickets, Projects, and Timers

Tasks need a clear place in the model:

- **Ticket** identifies the work item or deliverable
- **Project** groups related work at a higher level
- **Task** describes the kind of work being performed
- **Timer / TimeEntry / TimerSession** remains the canonical time ledger

That produces a cleaner model:

1. A timer may have a ticket and a task category.
2. A timer may have a task category even when there is no ticket.
3. Reports can roll time up by task category, by ticket, by project, or by
   team without duplicating time data.

This is closer to tagging or classification than to sub-task management.

---

## Why Tasks Might Matter

Tasks become more compelling when combined with existing features:

- **Timers** can classify time beyond just a ticket title
- **Reports** can answer questions like "how much time was spent on design this
  month?"
- **Clocked-in but unticketed work** can still be categorized as call,
  bookkeeping, planning, or support
- **Capacity planning** can distinguish feature work from overhead work
- **Activity summaries** can describe not only what was worked on, but what kind
  of work filled the day

This is the strongest case for tasks: they add semantic structure to time and
work reporting without multiplying core work objects.

---

## Reasonable First-Version Scope

If tasks are introduced, the first version should stay small:

1. Define a team-level or org-level list of allowed task categories.
2. Let timers or manual time entries optionally reference one task category.
3. Show the task category in timesheet and reporting views.
4. Add filtering and rollups by task category.
5. Keep task categories lightweight and admin-manageable.

That is enough to test whether task categories improve visibility without
creating a brand-new work management system.

---

## Explicit Risks

Tasks only help if the distinctions stay clear. Risks include:

- users confusing task categories with ticket types, priorities, or tags
- too many categories making reporting noisy or meaningless
- category sprawl across teams if governance is unclear
- trying to make categories carry workflow state they do not need

Those risks are a reason to keep the first version narrow and opinionated.

---

## Open Questions

These should be answered before writing an implementation plan:

1. Are task categories team-scoped, org-scoped, or a mix of both?
2. Should every timer have at most one task category, or can multiple labels be
   applied?
3. Are task categories required for unticketed time, optional for all time, or
   purely report-driven metadata?
4. How should task categories differ from ticket status, ticket type, and custom
   fields?
5. Which categories should exist by default: Development, Design, Call, Book
   Keeping, Support, Planning, or something else?

---

## Acceptance Criteria for a Future Real Plan

- there is a clear distinction between task categories and work items like
  tickets or projects
- the timer model remains single-source-of-truth for duration data
- task categories improve reporting and work classification without adding a new
  completion workflow
- the plan defines scope, ownership, and default category strategy before
  implementation begins
