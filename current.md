## Overview

Surface a richer, human-readable activity feed on a user's profile so teammates can quickly see how they've been showing up.

## Proposed Changes

- Show team-facing activity feed driven by the existing activity log
- Present activity as a grouped narrative, not raw event rows
- Surface recent standup/meeting participation when that feature exists
- Highlight blockers or recurring themes when there is enough signal

## Notes

This may require extending the activity log API to support profile-scoped queries or grouping. To be assessed during implementation.

## Acceptance Criteria

- [ ] Profile shows activity feed for the viewed user
- [ ] Activity is grouped and readable, not a raw event list
- [ ] Standup participation surfaces when available
- [ ] Blockers/themes only shown when there is sufficient signal

## Out of Scope (for Now)

- Full analytics or reporting dashboard
- Activity feed for self (this is the team-facing view only)

---

## Issue #136 — Show Current Work Snapshot on Profiles

## Overview

Display a high-level snapshot of what a user is currently working on, visible from their profile.

## Proposed Changes

- Show currently assigned tickets or recent work items
- Show recent work/time context at a summary level (not raw ledger detail)
- Optionally surface lightweight capacity/availability when that feature exists

## Acceptance Criteria

- [ ] Profile shows assigned/active tickets for the user
- [ ] Recent work is summarized, not shown as raw time entries
- [ ] Capacity/availability section is gated behind feature availability

## Out of Scope (for Now)

- Detailed time ledger or reporting
- Capacity planning features (tracked separately)
