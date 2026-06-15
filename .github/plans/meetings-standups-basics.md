# Standup Doc Replacement Plan

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

The current standup process lives in a Google Doc instead of in Huddle.
That creates a split workflow:

- Huddle holds the work context: tickets, time, activity, team membership
- the Google Doc holds the meeting flow, prompts, and notes
- the facilitator has to bridge those two systems manually during the meeting

That is the wrong first problem to solve with a generic "meetings platform." The right first problem is narrower: **replace the existing standup Google Doc with a Huddle flow that preserves how the team already runs standup while reducing manual work.**

If that replacement works, the underlying model can later expand to support other ceremonies. But the first version should be judged on one question:

**Can the team stop using the Google Doc for standups without losing the parts of the workflow that already work well?**

---

## Product Principle

The first implementation should mirror the current standup workflow as closely as possible.

That means:

- preserve the familiar sequence of the meeting
- preserve the current prompts or sections from the Google Doc
- preserve the facilitator's ability to run the meeting quickly
- pull in Huddle data where it removes effort, not where it changes the ritual unexpectedly
- defer broader meeting-type abstraction until the standup replacement is proven useful

The mistake to avoid is over-generalizing too early and shipping a flexible system that does not actually replace the team's current standup habit.

---

## Current Workflow Summary

The current workflow is now clear enough to ground the plan.

### Facilitator and Participants

- the meeting is run by a scrum master who is not a developer or engineer on
  the project
- participants are the scrum master and all developers on the team
- the company owner occasionally joins

### What the Google Doc Contains

The current Google Doc is not only a daily standup page. It is a broader team
operations document with:

- an intro page with team information
- a daily shorts or daily update page
- sprint planning sections
- retrospective sections
- resources tabs
- team rules
- bio tabs
- out-of-office tracking
- simple team-capacity tracking by percentage
- meeting notes and transcription notes tied to recordings

Outside the Google Doc, ticket organization also relies on a GitHub project
board today.

### What People Fill Out

The recurring information currently captured includes:

- daily updates
- tickets being worked on during sprint planning
- sprint goal
- blockers
- needs from other team members
- completed tickets
- personal bio information
- out-of-office days
- simple team capacity percentage
- general meeting notes
- transcription notes from meeting recordings

### What Happens Before vs During the Meeting

- before the meeting, each team member prepares their daily update
- during the meeting, everything else is handled live

### Daily Standup Mechanics

- each team member uploads a short video summarizing the previous day and what they are working on today
- if no video is provided, the update is given live during the meeting
- the meeting flow is: consume the person's update first, then ask whether they have blockers or need anything from the team
- the scrum master asks about each team member's open tickets
- the scrum master asks about blockers
- the scrum master may also capture needs from other team members
- a parking-lot section is used for side discussions or follow-up discussion

### Core Replacement Constraint

The pain point is simple: stop using a Google Doc for this workflow.

For v1, the strongest requirement is also simple: preserve most of the current workflow if possible.

---

## Confirmed Planning Assumptions

The documented workflow supports these assumptions for the first plan:

- there is a facilitator-led recurring standup for the team
- the facilitator moves person by person through the meeting
- daily updates are prepared before the meeting
- the prepared update may be a short video rather than only text
- ticket and blocker review happen live with the scrum master
- blockers and cross-team needs may be lightweight notes rather than a heavy structured workflow in v1
- the Google Doc acts as both a live standup tool and a broader team reference space

The workflow also depends on ticket organization that currently lives in a GitHub project board. That board context should be available during standup, even if board management ships as a separate feature.

That last point matters. Replacing the daily standup page alone may not be enough to fully retire the Google Doc if the team still depends on the other tabs for related coordination.

---

## Replacement Goal

The first Huddle standup experience should act like a structured in-product
version of the Google Doc.

In practical terms, that means:

- one team-level standup template that matches the current daily shorts
  structure
- one dated standup instance for each meeting
- one participant entry per person in the meeting
- a facilitator view for moving through the standup in order
- a participant view for reviewing or editing their own section if that is part
  of the current workflow
- read-only history after the standup is complete

To fully replace the Google Doc over time, Huddle will likely also need a
small set of adjacent surfaces beyond the daily standup itself. Based on the
current workflow, the minimum required follow-on surfaces are retrospectives,
planning, capacity, and meeting notes. Those should be acknowledged in the plan
even if the first shipped slice stays focused on the daily standup flow.

The first success state is not "we built a meeting system." The first success
state is "we no longer need the Google Doc for the daily standup."

---

## First-Version Workflow in Huddle

### 1. Standup Template

Each team has one standup template that represents the existing Google Doc
format.

It defines:

- standup name
- participant order rules or default order
- the update intake shape shown for each participant
- any fixed facilitator-only sections
- whether members can pre-fill their own responses before the meeting
- whether updates can be video, text, spoken, or some combination
- that blocker and teammate-need capture is notes-first in v1

For v1, the per-participant flow should come directly from the current Google
Doc habit rather than from a generalized custom-fields system unless the current
schema work is already ready and low-risk to reuse.

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

- an attached prepared short video if the member recorded one
- a prepared written daily update if that is used as fallback or supplement
- current sprint tickets as the preferred first slice
- current assigned tickets as the minimum fallback
- future planned tickets available as secondary context when needed
- recent time logged
- recent activity feed items
- current capacity or time-off indicators when available

This context should support the meeting, not overwrite the person's actual
update.

The main pre-meeting action in the current workflow is the daily update itself.
That means v1 should explicitly support "prepared update exists before the
meeting" rather than assuming all content is entered live.

### 4. During the Meeting

The facilitator opens the standup instance and steps through participants in the
same order the Google Doc would normally be used.

The UI should make it fast to:

- move to the next person
- view their prepared video or drafted notes
- capture live edits
- mark someone absent
- mark an entry complete
- flag blockers or follow-up items
- capture needs from other team members, likely in notes first
- keep discussion notes lightweight so parking-lot follow-up can happen in the
  same call without dedicated UI

The facilitator experience matters more than configurability in v1.

In the current workflow, the scrum master also reviews open tickets and asks
about blockers while moving through each participant. That should be treated as
part of the core standup flow, not as an optional enhancement.

For v1, blockers and teammate needs should default to notes-first capture. The
goal is to preserve the meeting flow, not to force a heavy triage workflow into
the first release.

### 5. After the Meeting

Once the standup is complete, the meeting should become a stable record.

That record should support:

- read-only review
- recent history by date
- quick scanning for blockers and follow-ups
- attached videos remaining available in history
- post-meeting edits only when they are logged via the existing activity feed
- inline edited markers on changed entries
- sprint rollups and later reporting on patterns once enough data exists

---

## Must-Stay-The-Same Rules for V1

The first version should intentionally keep these areas stable unless the real
workflow says otherwise:

- the prompt wording and structure from the current Google Doc
- the facilitator-led order of the meeting
- the ability to prepare a daily update before the meeting
- the ability to attach a short video update with a spoken fallback
- the ability to scan the whole team quickly
- the ability to edit notes during the meeting
- the ability to distinguish prepared notes from live discussion updates
- the ability to capture blockers and teammate needs without extra ceremony
- the ability to let parking-lot discussion happen outside the member-by-member
  flow without dedicated UI

If a proposed feature makes the flow more elegant in theory but harder to use
than the current doc in practice, it should not be in v1.

"Most of it if possible" is a strong signal that v1 should preserve not only
the daily update interaction, but also enough surrounding context that the team
does not need to keep the Google Doc open beside Huddle.

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
  updateMode: 'video_or_spoken' | 'text_only' | 'mixed';
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
  lockedAt?: Date;
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
  preparedVideoAttachmentId?: string;
  preparedSummaryText?: string;
  responses: Record<string, unknown>;
  blockerFlags?: string[];
  blockerAndNeedsNotes?: string;
  facilitatorNotes?: string;
  updatedAt?: Date;
}
```

Post-meeting edits should be emitted to the existing activity log rather than
stored as a dedicated standup-specific edit collection in v1.

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
- has-video indicator
- quick jump between people

### Participant Detail Panel

- participant identity
- prepared video or prepared daily update
- prompt responses matching the Google Doc structure
- open tickets and blocker review area
- inline edited marker when post-meeting changes exist
- recent Huddle context
- facilitator notes or live edits

### Adjacent Team Reference Surface

To retire the Google Doc completely, the product likely also needs adjacent
surfaces beyond the standup flow for:

- retrospectives
- planning
- capacity
- meeting notes

These do not all need to be built in the same release, but the replacement plan
should acknowledge them.

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
- heavy attachment workflows beyond attaching the prepared standup video
- a full dependency or blocker-management system
- dedicated parking-lot UI or parking-lot-specific data modeling
- complex recurring scheduling rules beyond what is necessary to replace the
  current standup habit

This is a replacement-flow feature, not a full collaboration suite.

Important nuance: the broader Google Doc contains sprint planning,
retrospectives, bios, resources, and rules. The minimum adjacent surfaces
needed to retire the document are planning, retrospectives, capacity, and
meeting notes. The other sections can stay explicitly deferred unless they turn
out to be required in practice.

---

## Relationship to Other Features

| Feature | How it helps the standup replacement |
|---------|-------------------------------------|
| **Tickets** | Surface current work so people do not have to manually copy it into the doc |
| **TicketView / board view** | Show the GitHub-project-style organization the team already uses while keeping standup focused on meeting flow |
| **Timers / time data** | Provide recent effort context before the meeting starts |
| **Activity feed** | Supply a compact narrative of recent work updates and log post-meeting edits without inventing a standup-specific audit subsystem |
| **Custom fields** | In a later version, allow the scrum master to design standup workflows with basic and advanced fields, and eventually pair those fields with more automatic workflow behavior |
| **Workflows** | In a future advanced version, event-triggered workflows could automate follow-up behavior around standups and other product surfaces without hardcoding ceremony-specific logic into v1 |
| **Team capacity** | Show OOO or limited availability on the standup view |
| **Notifications** | Remind people to pre-fill before the meeting, if that matches the workflow |
| **Reporting** | Later aggregate blockers, trends, and attendance patterns |

---

## Implementation Notes

The remaining work is now mostly implementation detail rather than product
direction:

- use inline edited markers in the UI and emit post-meeting edit events through
  the existing activity feed
- prefer current sprint tickets in the standup view, but allow future planned
  work to be inspected when needed
- do not build owner-specific participation UI; treat attendance as ad hoc
- keep parking-lot behavior inside normal standup notes and conversation flow
  rather than modeling it as its own feature

---

## Recommended Rollout Sequence

1. **Lock the daily standup workflow first**
  - Lock the update-first meeting flow, video behavior, notes-first blocker
    handling, teammate-need capture, and note-based parking-lot behavior.

2. **Define the standup template model**
  - Build the minimum data model needed to mirror that daily workflow inside
    Huddle.

3. **Build the standup run workflow**
  - Create a dated standup, snapshot participants and prompts, support prepared
    updates, and support live facilitator edits.

4. **Add facilitator-first UI**
  - Optimize for stepping through the meeting faster than the Google Doc while
    reviewing open tickets and blockers.

5. **Add pre-meeting context**
  - Pull in ticket, time, activity, OOO or capacity context, and relevant board
    state where it reduces prep work, preferring current sprint tickets first.

6. **Support attached video updates**
  - Reuse the existing storage system so members can attach a short video to
    their prepared daily update.

7. **Add archive and notes history**
  - Keep completed standups readable and useful as a durable record with video
    retention, inline edited markers, activity-log-backed edit history, and
    normal standup notes.

8. **Plan the adjacent replacement surfaces deliberately**
  - Prioritize retrospectives, planning, capacity, and meeting notes as the
    minimum non-standup surfaces needed to fully retire the document.

9. **Coordinate with a separate TicketView plan**
  - Keep standup focused on meeting flow while defining how ticket-board
    context appears beside it.

10. **Evaluate expansion only after adoption**
  - If the team fully abandons the Google Doc and the flow works, then consider
    broader meeting abstractions.

---

## Acceptance Criteria for the Plan

- The documented Huddle flow clearly maps to the current Google Doc process.
- The first version preserves the existing update flow, facilitator workflow,
  and prepared-update behavior.
- The plan identifies exactly what gets prepared before the meeting and what is
  edited live, including video or spoken fallback behavior.
- The plan supports attaching the prepared short video using the existing
  storage system.
- The plan preserves attached standup videos in history.
- The plan defines a clear replacement path so the Google Doc is no longer
  required for daily standups.
- The plan explicitly accounts for parking-lot discussion handling.
- The plan preserves lightweight capture of blockers and teammate needs without
  forcing a separate workflow system into v1.
- The plan supports frozen standups with activity-log-backed edits and inline
  edited markers after the meeting.
- The plan acknowledges the adjacent non-standup sections the current Google Doc
  also contains.
- The plan includes sprint rollups as a required reporting direction.
- The scope is intentionally narrow enough to ship without inventing a generic
  meeting platform first.

---

## Recommendation

The next correct step is not to design a generalized standup engine. The next
correct step is to capture the real standup workflow from the current Google Doc
and let that drive the first product slice.

Huddle should replace the existing standup document directly:

- same meeting rhythm
- same update-first meeting structure
- same prepared-update pattern, including attached short video when used
- less manual copy and paste
- richer live context from tickets, time, activity, and blockers

Only after that replacement works should the product generalize toward broader
meeting types.
