# Phase 0 answers — external blockers for Redmine time sync (M5)

Parent plan: [`redmine-m4-m5-time-sync-plan.md`](./redmine-m4-m5-time-sync-plan.md) → Phase 0.

This file exists so the answers are recorded rather than remembered. Phase 3 should start by
reading it.

> **Status: items 1 and 2 are ANSWERED (2026-09-20). Item 3 is outstanding but no longer
> blocked.** The gate on Phase 3 is lifted — see the caveat under item 3 before starting.

---

## 1. Does the users' Redmine role hold `edit_own_time_entries`?

**Answer: NOT WANTED — the question is withdrawn.** _(2026-09-20)_

The feature it would have enabled is explicitly out of scope for this version. Once a Redmine
ticket's time is logged, users should **not** be able to change it from TimeHuddle — the same way
they cannot casually change it in Redmine, where altering logged time is an administrative act.
No edit, no delete, no CRUD. Entries are created once and stay.

**What this changes in the plan.** The entire premise of the original Phase 3 — "POST once, then
`PUT` the same entry as the day's total grows" — is gone. Removed with it: the `PUT` path,
`403`-on-`PUT` handling, `404`-on-`PUT` recreation, and the "an edit in Redmine will be silently
overwritten" warning. Phase 3 gets materially smaller. This is recorded as **D1** in the parent
plan.

**⚠️ One permission is still required: `log_time`.** It is what permits _creating_ a time entry
at all, and it is a different checkbox from `edit_own_time_entries`. Without it every push fails
with `403`. Since redmine0 is administered by the project owner (see item 2), this is
self-serviceable — but it must be confirmed before the first push, not discovered during it.

---

## 2. Which Redmine target is write-safe?

**Answer: `redmine0.os.mieweb.org` — it is the project owner's own instance.** _(2026-09-20)_

It runs on the MIE web container, was created personally by the project owner, and is safe to
write to. The original concern — that `REDMINE_BASE_URL` pointed at a shared instance where the
first `POST /time_entries.json` would land in colleagues' production data — does not apply to it.
No scratch project, no designated throwaway issue, and no negotiation over shared infrastructure
are needed. Automated write-path tests against it are acceptable.

**Migration to the company instance is deliberately deferred.** Once the whole flow is proven on
redmine0 — timers, totals, the confirmation dialog, the push, read-back — pointing at the real
instance that records actual employee data is a `REDMINE_BASE_URL` configuration change, not a
code change. Recorded as **D3** in the parent plan.

**Scope confirmation captured at the same time:** this integration makes **no structural change
to Redmine**. The only write it performs, now or under this plan, is `POST /time_entries.json`.
Trackers, statuses, workflows, custom fields, roles, projects and issue data are read-only.
Preparing Huddle to talk to Redmine is the job; changing Redmine is not.

---

## 3. Manual M3 happy-path pass

**Answer: agreed, to be run on redmine0. Still outstanding.** _(2026-09-20)_

**⚠️ The original stated reason for this gap was wrong.** It claimed "no test account has a linked
Redmine instance". An account **is** linked — `priya.patel` (Redmine user 8), since 2026-09-11 —
and five `source: 'redmine'` work items exist for 2026-09-19. But **all five carry zero timer
sessions**, and the link has **no `defaultActivityId` set**. So the routing works (a numeric id
takes the Redmine branch and creates a Redmine-source work item), while the actual
start/switch/break/stop cycle has never run once, and the Phase 1 Settings control has never been
exercised. Phase 2's net-hours math is built on sessions the real UI has never produced.

**The shape of the test, as specified by the project owner.** Redmine tickets may already carry
time logged before the integration existed — one ticket might have 3h on it, another might be
fresh with zero. That is fine and must stay untouched: under D1 Huddle only ever _creates_ its own
entries, so pre-existing time is never read, reconciled or overwritten. What the pass proves is
that a user can clock in, run Redmine ticket timers through the normal day, and have the
calculations come out correct when they clock out.

**Steps:**

1. Link a real Redmine account in Settings → Redmine (personal API key), and set a default activity.
2. Clock in.
3. Open My Board, add a real Redmine issue, start its timer with ▶.
4. Switch to a second Redmine issue — this should **close** the first session and **open** a new one.
5. Take a break (pause), then resume — this should close and re-open again.
6. Return to the first issue for a further stretch, so one ticket accumulates two separate sessions.
7. Stop the timer, then clock out.
8. Inspect Mongo (mongo-express on `:8081`): confirm one `workitems` row per
   `{userId, source: 'redmine', ticketId, date}`, closed `timers` sessions pointing at them with
   break time absent, and that `netSecondsFor` per ticket matches a hand calculation — the first
   ticket's two stretches summing into a single total.

**Evidence to capture:** observed session counts and durations per ticket, dated, below.

**If it fails:** M3 has a latent bug — fix it before Phase 3 sends anything to Redmine.

**Result:** _PENDING_
**Date:** —

---

## 4. Activity resolution strategy

**Answer: derive from the Redmine issue's tracker.** _(2026-09-20)_

The rationale: the issue in Redmine already carries all its properties, so Huddle should read the
activity from Redmine's own data rather than inventing a parallel source of truth. Recorded as
**D4** in the parent plan.

**⚠️ Known wrinkle, to be handled rather than ignored.** Probed against redmine0 on 2026-09-20:

| Trackers                                | Activities                      |
| --------------------------------------- | ------------------------------- |
| `Bug` (1), `Feature` (2), `Support` (3) | `Design` (8), `Development` (9) |

The two vocabularies answer different questions — a tracker says _what kind of issue this is_, an
activity says _what kind of work you did on it_. All three trackers are engineering categories, so
the mapping collapses to **"always Development"** on this instance and `Design` would never be
selected. The approach is still correct (config-driven, zero user friction, becomes meaningful if
a design-oriented tracker is added later), but it cannot be the only input.

**Therefore:** user's chosen default → tracker map → `is_default` → named `Development` → first,
resolved **by name** against the live enumeration and never by hardcoded id. And because D1 makes
a wrong activity permanent, the resolved value must be **shown and overridable** in the push
confirmation dialog before anything is sent.

**⚠️ Ordering note.** This originally read _tracker → chosen default_. It was reversed while
implementing: because the map is degenerate, tracker-first would override the user's Settings
choice on every single issue and make that control meaningless. The explicit choice now wins, and
the tracker supplies the default for users who have not set one.

---

## Recording an answer

Replace `_PENDING_` with the answer, fill in the date, and attach or link the evidence.
