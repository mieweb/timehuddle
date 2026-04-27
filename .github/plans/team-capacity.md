# Team Capacity Planning

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

Team leads and scrum masters have no visibility into how much bandwidth each
team member actually has. Clock sessions tell you what *was* worked — but
planning requires knowing what's *available* going forward. Without capacity
data, sprint planning is guesswork and overcommitment is invisible until it's
too late.

---

## Prior Art: Harvest Forecast

[Harvest Forecast](https://www.getharvest.com/forecast) is the clearest
reference point. Its key ideas:

- Every team member has a **weekly capacity** (e.g. 40 hrs/week, or a custom
  amount for part-timers and contractors)
- Work is **scheduled** against that capacity in blocks — "Alice is on Project X
  for 3 hrs/day next week"
- **Time off** is entered as blocks that reduce available capacity
- The result is a **timeline view** — a horizontal grid of people × days showing
  utilization, free time, and conflicts at a glance
- Over/under-allocation is immediately visible (red = over, green = available)

Other tools with similar concepts: Linear's cycles, Jira's capacity planning in
Advanced Roadmaps, Teamwork's resource scheduler.

---

## Core Concept

Each team member has a **capacity profile** — their expected working hours per
day. Against that baseline, two things reduce availability:

1. **Time Off** — vacation, sick leave, holidays (full or partial days)
2. **Blocked Time** — recurring meetings, on-call rotations, other commitments
   that can't be scheduled over

What remains is **available capacity** — the hours a team lead can plan work
into.

```
Daily Capacity = Base Hours − Time Off − Blocked Time
```

---

## Views

### Timeline View (primary)
A horizontal calendar grid — rows are team members, columns are days/weeks.
Each cell shows:
- Available hours (green)
- Partially blocked (yellow)
- Time off / fully blocked (grey/red)
- Scheduled work (filled bar, coloured by ticket/project)

Inspired directly by Harvest Forecast's schedule view.

### Member Capacity Summary
Per-member view for a selected date range:
- Total available hours
- Total scheduled hours
- Remaining / over-allocated

### Team Rollup
Aggregate view: how much total team capacity exists this sprint vs. how many
hours of work are scheduled.

---

## Data Model (Rough)

```typescript
interface CapacityProfile {
  id: string;
  teamId: string;
  userId: string;
  hoursPerDay: number;       // e.g. 8, 6, 4 for part-time
  workDays: number[];        // [1,2,3,4,5] = Mon–Fri
  effectiveFrom: string;     // YYYY-MM-DD
}

interface TimeOffBlock {
  id: string;
  teamId: string;
  userId: string;
  startDate: string;         // YYYY-MM-DD
  endDate: string;           // YYYY-MM-DD (inclusive)
  hoursPerDay?: number;      // null = full day off
  label: string;             // "Vacation", "Sick", "Holiday"
  createdBy: string;
}

interface BlockedTimeBlock {
  id: string;
  teamId: string;
  userId: string;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  label: string;             // "On-call", "All-hands", "Client meeting"
  recurrence?: RecurrenceRule;  // future: recurring blocks
}
```

---

## Minimum Viable Feature

Before the full timeline UI, the smallest useful slice is:

1. **Capacity profiles** — set a member's hours/day and work days
2. **Time off entry** — member or admin logs a time-off block with a date range
3. **Blocked time entry** — admin logs a recurring or one-off block
4. **Capacity number on standup tab** — show "Available this week: 22 hrs" on
   each member's standup entry (immediate integration win)
5. **Dashboard widget** — team capacity bar for the current week

The full timeline view comes after the data model is solid.

---

## Integration Points

| Feature | How capacity connects |
|---------|----------------------|
| **Standups** | Member tab shows their capacity for the day/week |
| **Tickets** | Ticket time estimates vs. assignee's available hours |
| **Clock sessions** | Actual hours logged fills the "scheduled" portion of capacity |
| **Dashboard** | Team capacity widget — week at a glance |
| **Notifications** | Alert when a member is overallocated or time off overlaps a sprint |

---

## Time Off as a First-Class Citizen

Time off is the easiest entry point and has immediate value independent of the
full capacity feature:

- Any team member can log their own time off
- Admins can log time off on behalf of members
- Time off appears on the standup tab ("Alice is OOO today")
- Holidays can be configured at the team level (e.g. US federal holidays)
- Future: sync with Google Calendar / Outlook

---

## AI Component (Future)

- **Overallocation warnings**: "If you add this ticket to Bob's sprint, he will
  be at 110% capacity given his time off next Thursday"
- **Sprint capacity advisor**: before sprint planning, surface total available
  team hours vs. historical velocity to recommend a sustainable story point
  target
- **Automatic rebalancing suggestions**: when someone logs unexpected time off,
  suggest which tickets to reassign and to whom based on availability

---

## Open Questions

- **Who sets capacity profiles?** Admin only, or can members self-report?
- **Approval workflow for time off?** Simple log vs. request → approve flow?
- **Integration with external calendars?** Pull time off from Google/Outlook, or
  keep it self-contained?
- **Part-time / contractor members?** How to handle variable weekly schedules?
- **Holiday calendars?** Team-level, region-based, or manual?
- **Granularity?** Is day-level resolution enough, or do we need hour-level
  blocks (e.g. "out 1–3pm Thursday")?

---

## Possible Rollout Sequence

1. **Capacity profiles** — hours/day and work days per member
2. **Time off blocks** — self-service entry, visible on standup tabs
3. **Blocked time** — one-off and recurring blocks
4. **Dashboard widget** — team capacity summary for the current week
5. **Timeline view** — full horizontal schedule grid
6. **Ticket integration** — estimated hours vs. available capacity
7. **AI overallocation warnings** — real-time sprint planning guard
