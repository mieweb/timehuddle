# Redmine integration — design notes

Why the Redmine integration behaves the way it does. For what it does, read [`redmine-integration.md`](./redmine-integration.md) first; for how the code is laid out, see the READMEs under [`src/features/tickets/`](../src/features/tickets/).

This replaces the milestone plans the integration was built from. Code comments still cite those plans' labels; the [key](#labels-used-in-code-comments) at the end says what each one means.

---

## The rule everything follows

> **TimeHuddle is the system of record for _how_ time was spent. Redmine's "Spent time" is a derived, one-way projection of it — never an input.**

- Sessions, breaks and notes stay in TimeHuddle. Redmine receives totals per issue per day.
- Time logged in Redmine by hand is never reconciled or overwritten. TimeHuddle only adds its own entries beside it, so it cannot double-count what it never reads into its totals.
- TimeHuddle writes to Redmine in exactly three ways: creating a time entry, creating an issue, and updating an issue. Trackers, statuses, workflows, roles and projects are read-only.

## Who a request runs as

Every Redmine request is made with the calling user's own personal API key, sent in the `X-Redmine-API-Key` header. There is no admin or service account and no `X-Redmine-Switch-User`. Redmine therefore enforces each user's permissions and records them as the author.

This is also why Redmine issues stay out of team-level views: an issue is only ever read through one person's key. Where one user reads another's data (an admin opening a member's timesheet), titles are resolved with the **viewer's** key, not the owner's.

## What is stored, and what is not

| Stored in TimeHuddle                                     | Never stored                               |
| -------------------------------------------------------- | ------------------------------------------ |
| The encrypted API key and the user's Redmine id          | Issue subjects, descriptions, journals     |
| Work items and timer sessions, as `{ source, ticketId }` | Search text and search results             |
| My Board rows and pins/dismissals, as issue ids          | Anything Redmine returns, beyond those ids |
| One row per time entry sent, with the seconds it covered |                                            |
| Attachments a user adds to an issue's page               |                                            |

Issue content is read live. Only slow-changing lists (projects, trackers, members, priorities) and the per-user relevant list sit in a short in-process cache, keyed by user and cleared when the user links, unlinks, pins or dismisses. Issue subjects and search terms can contain patient information, which is the reason for this rule; it costs a round trip per page load.

## Time tracking

- **A ticket timer requires an open shift.** It therefore inherits the shift's 8-hour auto clock-out, so a forgotten timer cannot run indefinitely.
- **Breaks are structural.** A break closes the running session and resuming opens a new one, so break time never has to be subtracted.
- **Shift time and ticket time are separate numbers** and are never added together. Only ticket-timer time reaches Redmine.

## Pushing time to Redmine

| Rule                              | What it means                                                                                                                                                              | Why                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create-only**                   | Entries are never edited or deleted from TimeHuddle.                                                                                                                       | Logged time is a record. Correcting it is an administrative act in Redmine. It also removes any need for edit permissions.                                            |
| **Manual and confirmed**          | The user presses Send while clocked out with no timer running, and approves a summary first.                                                                               | Only the user knows when their day is final.                                                                                                                          |
| **Several entries per issue-day** | Each push sends, as a new entry, the day's total in whole minutes less the minutes already sent.                                                                           | With create-only, a single entry per day could never grow, so work done after a mid-day push was lost. Redmine sums entries per issue, so its total stays right.      |
| **Read-back**                     | After each create, the entry is fetched and its hours compared with what was sent. An entry that cannot be read back is reported as unconfirmed, and still counts as sent. | It is the only way to know what Redmine actually stored. This check is what caught the rounding issue below.                                                          |
| **Whole minutes**                 | Seconds are rounded to whole minutes once, on the day's summed total and never on each push's share, then sent as hours to two decimals.                                   | Redmine converts submitted hours to `round(hours × 60)` minutes. A figure already on a minute boundary survives that unchanged. Totals under 30 seconds are not sent. |
| **Activity resolved at runtime**  | Order: the user's choice → the issue's tracker → the instance default → one named `Development` → the first available.                                                     | Activity ids differ per instance, and omitting one fails when the instance has no default.                                                                            |
| **One push at a time**            | A push takes a per-user lock, renews it before every entry, and releases only its own. A lock not renewed for 2 minutes is treated as abandoned.                           | Two concurrent pushes would otherwise both send the same unsent time.                                                                                                 |
| **Never send**                    | A row can be discarded: recorded as handled, nothing sent.                                                                                                                 | Under create-only there must be a way to leave a bad row out.                                                                                                         |

## Issues in the table and in search

- **The table is not "every issue you can see".** It holds issues assigned to the user plus the ones they pinned by starting a timer or putting them on My Board. Every query to Redmine's issue list must carry a narrowing parameter; the code refuses to send one without it.
- **Suggestions are scored from several small queries** run in parallel: timer running, assigned, logged time in the last 14 days, recent activity, watching, pinned. Each has its own timeout; a signal that fails is dropped and the list is marked partial instead of failing.
- **Hiding a suggestion never touches the table or Redmine.** It expires after 15 days, and is cleared at once if the issue becomes assigned to the user.
- **Pins are capped at 500 and refused at the cap; dismissals are capped at 500 and the oldest is evicted.** A dismissal is a temporary "not now"; a pin is what keeps a row in the user's table, so dropping one silently would lose work. My Board is capped at 500 for the same reason pins are.

## Editing an issue

A save sends the issue's `updated_on` as the user last saw it. The server re-reads the issue, refuses the save as stale if it changed meanwhile, sends only the fields that differ, then reads the issue back and reports any field Redmine stored differently (a workflow rule or plugin may change it). Status choices come from Redmine's own allowed transitions for that user.

## Security

- **Key at rest:** AES-256-GCM, with a versioned ciphertext. A previous key can be supplied during rotation; a key that only opens under it is re-encrypted on first use.
- **Key in transit:** only ever in the request header, never in a URL, including the activity feed.
- **Redirects are refused.** A redirect could hand the key header to another host.
- **Where requests can go:** in production, only `REDMINE_BASE_URL`'s host and those in `REDMINE_ALLOWED_HOSTS`, over `https`. A per-user URL (`REDMINE_ALLOW_CUSTOM_URL`) is for development only, because the server will fetch whatever URL is linked.
- **Logs:** method, path without its query string, status and duration. Never a full URL, body, header or search term.
- **Rate limits:** search, the relevant list, the preference methods, and the connect, activity and push methods are limited per user. The limits are applied inside the methods, because calls arrive over the REST bridge, which Meteor's DDP rate limiter does not see.

## Known limits

- **A crash mid-push can duplicate an entry.** If the server stops after Redmine accepts an entry and before TimeHuddle records it, the next push sends that time again. Closing this needs a pending record written before the call and reconciled afterwards.
- **Issue ids are not tied to an instance.** Board rows, work items and sync records hold only the issue number. If a deployment's Redmine URL changed, old ids would be read as issues on the new instance. The instance can only change between shifts, and unlinking clears pins and dismissals, but board rows and sync records are kept.
- **A manual edit in Redmine's Spent time tab is not detected** and does not flow back.

## Labels used in code comments

| Label                         | Meaning                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| **M1**                        | Connecting an account with a personal API key                                              |
| **M2, M2.1, M2.2**            | Redmine issues in the Tickets page; the unified table; My Board                            |
| **M3, M3.1**                  | Ticket timers on Redmine issues; sessions nested in the timesheet                          |
| **M4**                        | Net hours per issue per day, and activity resolution                                       |
| **M5**                        | The push to Redmine                                                                        |
| **M6**                        | Creating and editing Redmine issues                                                        |
| **MVP2 Part A (tasks A1–A5)** | Filtered issue queries, the relevant list, search, pins and dismissals, security hardening |
| **MVP2 Part B (tasks B1–B5)** | The search suggestions dropdown                                                            |
| **D1**                        | The push is create-only                                                                    |
| **D2**                        | The push is manual and confirmed                                                           |
| **D4**                        | The activity is derived from the issue's tracker, falling back to the user's default       |
| **D5**                        | An issue-day may be pushed more than once, each push sending only unsent time              |

The D-labels above are the push decisions. A few comments on the timer flow use their own (for example `M3 D1`); those refer to how a ticket timer is started and stopped.
