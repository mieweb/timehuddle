# Meetings Standups Basics

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

TimeHuddle has tickets, time tracking, team membership, messages, and activity,
but it has no structured way for a team to run recurring ceremonies inside the
product.

Today that means teams run standups, check-ins, and similar meetings in Google
Docs, Slack threads, or outside tools. The context for those meetings lives in
TimeHuddle, but the meeting itself does not.

The first obvious use case is the daily standup. But the better mental model is
not "build a standup feature". The better model is "build a dynamic meeting
system" where a standup is the first meeting type.

That keeps us from hardcoding one ceremony and then rebuilding the same system
again later for retrospectives, sprint planning, weekly check-ins, or incident
reviews.

---

## Core Concept

A **Meeting Type** defines the structure of a recurring team ceremony.

A **Meeting** is one dated instance of that type for a specific team.

A **Meeting Entry** is one participant's response/context inside that meeting.

For the first rollout, the only meeting type exposed in the UI is `standup`.

```text
MeetingType (team-scoped template)
  ├── name / slug
  ├── agenda structure
  ├── field schema
  ├── permissions
  └── prefill rules

Meeting (one dated occurrence)
  └── MeetingEntry (one per participant)
        ├── participant identity
        ├── fixed context blocks
        ├── custom field responses
        ├── attachments
        └── completion / status metadata
```

Under this model:

- a **standup** is a meeting type with one entry per team member,
- each entry asks structured questions like yesterday / today / blockers,
- the entry can also surface TimeHuddle context like current tickets or recent
  work,
- future meeting types can reuse the same machinery without inventing a second
  subsystem.

---

## Why This Model Is Better Than "Standup" As the Root Concept

If we make standup the top-level abstraction, we will likely hardcode:

- standup-specific fields,
- standup-specific permissions,
- standup-specific summaries,
- standup-specific data structures.

That is fine for a quick prototype, but it creates a dead-end model.

If we instead treat standup as the first **meeting type**, then we can keep the
first shipped experience very standup-specific while still designing storage and
workflow around a more durable concept.

This gives us room for future types like:

- retrospectives,
- sprint planning,
- weekly check-ins,
- incident reviews,
- one-on-ones.

The key discipline is: **generalize the model, not the first UI**.

---

## Standup as the First Meeting Type

The first concrete meeting type should be a daily standup.

Its shape would be:

- team-scoped
- date-stamped
- created by a team admin or scrum master
- one entry per active team member
- a fixed question flow like:
  - what did you do yesterday?
  - what are you doing today?
  - any blockers?
- optional prefilled context from TimeHuddle data
- a lock/archive state after the meeting completes

So while the data model says "meeting", the first user-facing experience still
looks and feels like a standup.

---

## User Experience Model

### Meeting Type

A team can define one or more meeting types in the future, but initially only
the built-in `standup` type matters.

Over time a meeting type could define:

- display name
- cadence or scheduling defaults
- participant selection rules
- field schema
- fixed context blocks
- summary behavior
- permissions for creation, editing, locking, and archiving

### Meeting Instance

A meeting instance is one occurrence, for example:

- Daily Standup for Team Alpha on 2026-05-07
- Sprint Retro for Team Alpha on 2026-05-14

For standups, the meeting instance should pre-create one participant entry per
active team member so the facilitator can move through the meeting quickly.

### Participant Entry

Each participant entry is the unit that holds:

- identity of the participant
- structured responses
- auto-pulled context
- attachments
- completion state
- absence state if relevant

This is the practical replacement for the current plan's "member tab" concept.
The tab is a presentation detail; the durable concept is a participant entry.

---

## What a Standup Entry Shows

Each standup entry should have two layers.

### Fixed Context Layer

Always-present TimeHuddle context that helps the person speak without hunting
through other screens.

Examples:

- participant name, avatar, and team role
- recent work items or assigned open tickets
- recent logged time or work summaries
- recent activity context if useful
- attachments or linked references

### Structured Response Layer

Questions defined by the meeting type.

For standups, that likely starts with a fixed built-in structure rather than a
fully dynamic custom-field system on day one:

- yesterday
- today
- blockers

Later, that can evolve to use a reusable field-schema system if and when the
custom-fields platform exists.

---

## Facilitator Controls

For the standup meeting type, the facilitator or admin likely needs to:

- create a meeting for a date
- open the meeting and step through participants
- reorder participants for presentation flow
- mark someone absent
- edit or review participant entries
- lock the meeting after completion
- view a summary or archive view

These controls are specific to the standup experience, but they should be built
on top of generic meeting and participant-entry concepts.

---

## Pre-Population Strategy

The biggest product win is not the form itself. The win is reducing meeting
friction by pre-populating context.

For standups, useful prefill candidates are:

- recently worked tickets
- current assigned tickets
- recent logged time
- recent activity feed items
- recent messages or notes if they later become relevant

Important constraint:

Pre-populated context should be treated as supporting material, not silent truth
that overwrites what a person wants to say.

The user should review, trim, or replace it.

---

## Data Model (Rough)

```typescript
interface MeetingType {
  id: string;
  teamId: string;
  key: string; // e.g. 'standup', 'retro'
  name: string;
  description?: string;
  status: 'active' | 'archived';
  fieldSchemaId?: string;
  settings?: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
}

interface Meeting {
  id: string;
  teamId: string;
  meetingTypeId: string;
  createdBy: string;
  date: string; // YYYY-MM-DD
  label?: string;
  status: 'open' | 'locked' | 'archived';
  createdAt: Date;
  updatedAt?: Date;
}

interface MeetingEntry {
  id: string;
  meetingId: string;
  userId: string;
  absent: boolean;
  position?: number;
  fieldValues: Record<string, unknown>;
  attachments: Attachment[];
  submittedAt?: Date;
  updatedAt?: Date;
}
```

For the first release, this would still effectively behave like:

- one built-in `MeetingType` with `key = 'standup'`
- one `MeetingEntry` per active team member
- a standup-focused UI that does not expose arbitrary meeting-type creation yet

---

## Relationship to Other Features

| Feature | Relationship |
|---------|-------------|
| **Tickets / work items** | Surface recent or assigned work as standup context |
| **Work / timers / timesheet** | Provide recent time context for participant entries |
| **Activity log** | Source for pre-filled recent activity and later summaries |
| **Messages** | Potential future source for blockers or discussion context |
| **Custom fields** | Later path to reusable dynamic meeting questions |
| **Notifications** | Reminders before a meeting starts or before entries are due |
| **Dashboard** | Future widget for latest standup / meeting summary |

---

## AI Component (Future Only)

This model also gives AI a cleaner place to plug in later, but AI should not be
part of the first implementation.

Possible future uses:

- draft standup responses from recent activity
- detect likely blockers from work patterns or messages
- summarize a completed meeting
- synthesize patterns across multiple meetings in a sprint

Architectural note:

Keep meeting entries structured and typed so AI features can read good input.
Do not bury important signals in unstructured blobs if we expect later
automation.

---

## Open Questions

- who can create a meeting instance for the standup type?
- should standups be manually created or scheduled automatically?
- can participants fill out their own entries before the meeting starts?
- do we support only one built-in meeting type at first, or store the generic
  model from day one but hide everything except standups?
- do participant entries need comments/discussion, or only structured responses?
- when the custom-fields system arrives, do standups stay partly fixed and
  partly dynamic, or become fully schema-driven?

---

## Recommended Rollout Sequence

1. **Generic data model, standup-only product surface**
   - Introduce `Meeting`, `MeetingEntry`, and either a built-in or implicit
     `standup` meeting type.
   - Ship only the standup experience in the UI.

2. **Minimal standup flow**
   - Create standup meeting
   - Pre-create participant entries
   - Step through participants
   - Record responses
   - Lock and archive

3. **Context prefill**
   - Pull in work items, recent time, and relevant activity context.

4. **Summary and archive views**
   - Read-only summary after the meeting closes.

5. **Custom schema support**
   - Integrate with a future field-schema system if that platform is built.

6. **Additional meeting types**
   - Only after the standup pattern proves itself.

7. **AI assistance**
   - Drafting, blocker detection, and summaries later.

---

## Recommendation

Standup should be treated as the **first dynamic team meeting type**, not as a
one-off standalone subsystem.

That gives TimeHuddle the right long-term shape:

- generic enough to support future ceremonies
- concrete enough to ship a focused standup first
- structurally aligned with the rest of the product's team/work/activity model

The implementation bar should be: **generalize the storage model just enough,
but keep the first UX unapologetically standup-specific.**

---

## High-Level Task Breakdown

To gauge the work, the feature likely breaks down into these major tasks:

1. **Finalize product rules**
  - Decide who can create standups, whether entries are self-editable, and when a meeting becomes locked.

2. **Define the backend model**
  - Introduce the meeting, meeting entry, and standup-type persistence model with clear status rules.

3. **Add backend APIs**
  - Create endpoints for creating a standup, listing standups, loading one standup, updating entries, reordering entries, marking absences, and locking/archive flows.

4. **Wire standup context sources**
  - Decide what ticket, work, timesheet, and activity data gets surfaced in each entry and how it is queried efficiently.

5. **Build the standup UI shell**
  - Add the standup route/page, team-scoped meeting list, standup detail view, and participant-entry presentation flow.

6. **Build facilitator controls**
  - Support creation, participant ordering, absent toggles, locking, and archive/summary access.

7. **Build participant entry editing**
  - Support structured responses, save/update behavior, and any lightweight attachment/reference handling chosen for MVP.

8. **Add summary and archive views**
  - Provide a completed-meeting read-only summary and a way to revisit past standups.

9. **Add permissions and validation**
  - Enforce team membership, creator/admin rules, edit windows, and backend validation for meeting state transitions.

10. **Add notification hooks**
  - If included in MVP, wire reminder and meeting-start notifications.

11. **Test the feature end to end**
  - Cover backend behavior, UI workflows, locking rules, absent flows, and summary/archive paths.

12. **Plan the next layer deliberately**
  - Decide whether the next increment is context prefill depth, custom-field integration, recurring scheduling, or broader meeting types.

At a rough level, this feels like a **large feature** rather than a small add-on because it touches data model, backend APIs, permissions, UI flow, and cross-feature integrations.
