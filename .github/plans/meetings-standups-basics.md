# Standup Doc Replacement Plan

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

The current standup process lives in a Google Doc instead of in TimeHuddle.
That creates a split workflow:

- TimeHuddle holds the work context: tickets, time, activity, team membership
- the Google Doc holds the meeting flow, prompts, and notes
- the facilitator has to bridge those two systems manually during the meeting

That is the wrong first problem to solve with a generic "meetings platform."
The right first problem is narrower: **replace the existing standup Google Doc
with a TimeHuddle flow that preserves how the team already runs standup while
reducing manual work.**

If that replacement works, the underlying model can later expand to support
other ceremonies. But the first version should be judged on one question:

**Can the team stop using the Google Doc for standups without losing the parts
of the workflow that already work well?**

---

## Product Principle

The first implementation should mirror the current standup workflow as closely
as possible.

That means:

- preserve the familiar sequence of the meeting
- preserve the current prompts or sections from the Google Doc
- preserve the facilitator's ability to run the meeting quickly
- pull in TimeHuddle data where it removes effort, not where it changes the
  ritual unexpectedly
- defer broader meeting-type abstraction until the standup replacement is
  proven useful

The mistake to avoid is over-generalizing too early and shipping a flexible
system that does not actually replace the team's current standup habit.

---

## Current Workflow to Capture

Before implementation, the standup plan should be grounded in the actual Google
Doc workflow. These are the concrete questions that still need to be pinned
down:

1. Who runs the meeting?
2. Who participates?
3. What does the Google Doc look like today?
4. What sections or prompts do people fill out?
5. What gets prepared before the meeting versus during it?
6. What pain points are you trying to eliminate?
7. What absolutely must stay the same in a first version?

Those answers matter more than any abstract standup best practice. The first UI,
permissions, and data model should be derived from them.

---

## Working Assumption for Planning

Until the exact workflow is documented, the safest planning assumption is:

- there is one recurring standup per team
- a facilitator runs through the team in a predictable order
- each participant has a small, repeated set of prompts in the Google Doc
- some information is prepared before the meeting
- some notes are updated live during the meeting
- the biggest win is moving that process into the same place as tickets, time,
  and activity

This is intentionally conservative. The design should fit the real workflow once
it is written down, not force the workflow to fit a preconceived standup model.

---

## Replacement Goal

The first TimeHuddle standup experience should act like a structured in-product
version of the Google Doc.

In practical terms, that means:

- one team-level standup template that matches the current doc structure
- one dated standup instance for each meeting
- one participant entry per person in the meeting
- a facilitator view for moving through the standup in order
- a participant view for reviewing or editing their own section if that is part
  of the current workflow
- read-only history after the standup is complete

The first success state is not "we built a meeting system." The first success
state is "we no longer need the Google Doc for the daily standup."

---

## First-Version Workflow in TimeHuddle

### 1. Standup Template

Each team has one standup template that represents the existing Google Doc
format.

It defines:

- standup name
- participant order rules or default order
- the prompt list shown for each participant
- any fixed facilitator-only sections
- whether members can pre-fill their own responses before the meeting

For v1, the prompt list should come directly from the current Google Doc rather
than from a generalized custom-fields system unless the current schema work is
already ready and low-risk to reuse.

### 2. Standup Instance

Each meeting creates one dated standup instance for the team.

It should:

- snapshot the participant list for that day
- snapshot the prompt structure used for that run
- pre-create one participant entry per attendee
- support `open`, `in_progress`, `locked`, and `archived` states

This protects historical standups from later template edits.

### 3. Before the Meeting

Before the standup starts, the system should reduce prep work by surfacing
helpful context next to each participant entry.

Candidate context:

- current assigned tickets
- recently updated tickets
- recent time logged
- recent activity feed items
- current capacity or time-off indicators when available

This context should support the meeting, not overwrite the person's actual
update.

### 4. During the Meeting

The facilitator opens the standup instance and steps through participants in the
same order the Google Doc would normally be used.

The UI should make it fast to:

- move to the next person
- view their prepared or drafted notes
- capture live edits
- mark someone absent
- mark an entry complete
- flag blockers or follow-up items

The facilitator experience matters more than configurability in v1.

### 5. After the Meeting

Once the standup is complete, the meeting should become a stable record.

That record should support:

- read-only review
- recent history by date
- quick scanning for blockers and follow-ups
- later reporting on patterns once enough data exists

---

## Must-Stay-The-Same Rules for V1

The first version should intentionally keep these areas stable unless the real
workflow says otherwise:

- the prompt wording and structure from the current Google Doc
- the facilitator-led order of the meeting
- the ability to scan the whole team quickly
- the ability to edit notes during the meeting
- the ability to distinguish prepared notes from live discussion updates

If a proposed feature makes the flow more elegant in theory but harder to use
than the current doc in practice, it should not be in v1.

---

## Data Model (Rough)

```typescript
interface StandupTemplate {
  id: string;
  teamId: string;
  name: string;
  promptDefinitions: StandupPromptDefinition[];
  defaultParticipantOrder: string[];
  allowParticipantPrefill: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

interface StandupRun {
  id: string;
  teamId: string;
  standupTemplateId: string;
  date: string; // YYYY-MM-DD
  createdBy: string;
  status: 'open' | 'in_progress' | 'locked' | 'archived';
  participantSnapshot: StandupParticipantSnapshot[];
  promptSnapshot: StandupPromptDefinition[];
  createdAt: Date;
  updatedAt?: Date;
}

interface StandupParticipantEntry {
  id: string;
  standupRunId: string;
  userId: string;
  position: number;
  absent: boolean;
  completionState: 'not_started' | 'in_progress' | 'complete';
  responses: Record<string, unknown>;
  blockerFlags?: string[];
  facilitatorNotes?: string;
  updatedAt?: Date;
}
```

This is deliberately standup-specific. If the feature later expands to other
meeting types, that can happen after the workflow proves out.

---

## UI Shape

The most likely first UI is a standup page with three layers:

### Team-Level Header

- standup date
- team name
- meeting status
- progress across participants
- start, lock, and archive controls

### Participant List or Navigator

- ordered list of participants
- completion state per person
- absent indicator
- blocker indicator
- quick jump between people

### Participant Detail Panel

- participant identity
- prompt responses matching the Google Doc structure
- recent TimeHuddle context
- facilitator notes or live edits

This can be tabs, cards, or a master-detail layout. The key is that it should
feel faster than scrolling a shared document.

---

## Scope Boundaries

The first version should not try to solve all meeting-related needs.

Out of scope for v1:

- retrospectives, sprint planning, one-on-ones, or other ceremony types
- broad meeting-builder functionality
- AI-generated summaries or AI-written responses
- deep comments or discussion threads on each entry
- heavy attachment workflows
- complex recurring scheduling rules beyond what is necessary to replace the
  current standup habit

This is a replacement-flow feature, not a full collaboration suite.

---

## Relationship to Other Features

| Feature | How it helps the standup replacement |
|---------|-------------------------------------|
| **Tickets** | Surface current work so people do not have to manually copy it into the doc |
| **Timers / time data** | Provide recent effort context before the meeting starts |
| **Activity feed** | Supply a compact narrative of recent work updates |
| **Team capacity** | Show OOO or limited availability on the standup view |
| **Notifications** | Remind people to pre-fill before the meeting, if that matches the workflow |
| **Reporting** | Later aggregate blockers, trends, and attendance patterns |

---

## Open Product Decisions

These decisions should be made from the current Google Doc workflow, not from a
generic agile template:

- Is the standup primarily facilitator-driven, participant-driven, or mixed?
- Do participants edit before the meeting, during the meeting, or both?
- Does every person get the same prompts, or are there special sections for
  roles like lead, scrum master, or QA?
- Is the record mostly for live facilitation, later accountability, or both?
- Do blockers need a special field or just plain text in v1?
- Should entries freeze immediately at the end of the meeting or remain editable
  for a short window?
- Does the team need a daily history view, a weekly rollup, or both?

---

## Recommended Rollout Sequence

1. **Capture the real workflow**
   - Document the current Google Doc structure, participant roles, prompts, and
     prep and live steps.

2. **Define the standup template model**
   - Build the minimum data model needed to mirror that structure inside
     TimeHuddle.

3. **Build the standup run workflow**
   - Create a dated standup, snapshot participants and prompts, and support live
     entry updates.

4. **Add facilitator-first UI**
   - Optimize for stepping through the meeting faster than the Google Doc.

5. **Add pre-meeting context**
   - Pull in ticket, time, and activity context where it reduces prep work.

6. **Add archive and history**
   - Keep completed standups readable and searchable enough to replace old docs.

7. **Evaluate expansion only after adoption**
   - If the team fully abandons the Google Doc and the flow works, then consider
     broader meeting abstractions.

---

## Acceptance Criteria for the Plan

- The documented TimeHuddle flow clearly maps to the current Google Doc process.
- The first version preserves the existing prompts and facilitator workflow.
- The plan identifies exactly what gets prepared before the meeting and what is
  edited live.
- The plan defines a clear replacement path so the Google Doc is no longer
  required for daily standups.
- The scope is intentionally narrow enough to ship without inventing a generic
  meeting platform first.

---

## Recommendation

The next correct step is not to design a generalized standup engine. The next
correct step is to capture the real standup workflow from the current Google Doc
and let that drive the first product slice.

TimeHuddle should replace the existing standup document directly:

- same meeting rhythm
- same prompt structure
- less manual copy and paste
- richer live context from tickets, time, and activity

Only after that replacement works should the product generalize toward broader
meeting types.
