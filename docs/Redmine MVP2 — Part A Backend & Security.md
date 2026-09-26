# Redmine MVP2 — Part A: Backend & Security

Sep 25, 2026 · @Shubhdeep Sarkar

## Overview

Part A replaces the "fetch every issue" call with two small, filtered server methods, adds a per-user preferences store (pins and dismissals, ids only), and hardens how TimeHuddle talks to Redmine. It owns everything under `meteor-backend/server/`.

Today `listIssues` with `scope: 'all'` returns every issue the user's key can see. On the enterprise instance that is a very large set, and issue titles and descriptions can contain PHI. After MVP2, TimeHuddle only ever asks Redmine for issues that are relevant to the user, or for issues the user explicitly searched for.

**How the work is split**

| Part | Owns | Depends on |
| --- | --- | --- |
| A: Backend & Security (this doc) | Meteor methods, Redmine client calls, Mongo collection, security fixes, backend tests | Nothing. Can start now |
| B: Search Dropdown & UX | Search bar dropdown, dismiss and undo, states, i18n, release note, e2e tests | The API contract below. Can build against a stub until A lands |

The API contract in the next section is the handshake between the two parts. Change it only by agreement.

## API contract (shared with Part B)

Four new Meteor methods. All of them use the caller's own Redmine key, and all return the same slim issue shape.

| Method | Input | Returns |
| --- | --- | --- |
| `redmine.issues.relevant` | `{ includeDismissed?: boolean }` | `{ connected, baseUrl, issues: RelevantIssue[], partial }` |
| `redmine.issues.search` | `{ query: string }` | `{ connected, baseUrl, kind, issues: SlimIssue[] }` |
| `redmine.prefs.set` | `{ issueId, state: 'pinned' \| 'dismissed' \| null }` | `{ ok: true }`. `null` clears the preference (used by Undo and Restore) |
| `redmine.prefs.listDismissed` | none | `{ issues: SlimIssue[] }` for the Restore list |

**Shapes**

- `SlimIssue`: `id`, `subject`, `project { id, name }`, `status { name, isClosed }`, `priority { name }`, `assignedTo { id, name } | null`, `updatedAt`. **No description, notes or custom fields.**
- `RelevantIssue`: `SlimIssue` plus `reasons: ('running' | 'assigned' | 'logged' | 'activity' | 'watching' | 'pinned')[]`, `score: number` and `lastTimeLoggedAt?: string`. The list arrives already sorted. Dismissed issues are excluded unless includeDismissed is true: the search dropdown leaves it off, and the Tickets page table turns it on, because dismissals only affect the dropdown.
- `partial: true` means at least one signal timed out. Part B shows the list anyway.
- `kind` on search echoes how the query was read: `'id' | 'url' | 'assignee' | 'text'`. Part B can use it for the empty-state message.

**Errors** reuse the existing `toRedmineMeteorError` codes, plus `too-many-requests` from the rate limiter.

The old `redmine.issues.list` method is removed (see the scope task below).

## Task A1: `redmine.issues.relevant`

The method runs one small, filtered Redmine query per signal, all in parallel. It merges the results by issue id, scores them, and returns at most 100.

| Signal | Redmine call | Score |
| --- | --- | --- |
| Timer running on it | TimeHuddle's own running `WorkItem` (no Redmine call) | 100 |
| Assigned to me, open | `/issues.json?assigned_to_id=me&status_id=open&sort=updated_on:desc&limit=100` | 60 |
| I logged time on it | `/time_entries.json?user_id=me&from=<14 days ago>&limit=100` → issue ids | 50, minus 2 per day since the last entry |
| My activity feed | `/activity.atom?user_id=<my id>&from=<14 days ago>` → issue ids only | 40, minus 2 per day |
| Watching, open | `/issues.json?watcher_id=me&status_id=open&limit=50` | 20 |
| Pinned in TimeHuddle | Pin ids from Task A3 → `/issues.json?issue_id=…&status_id=*` | 30 |

An issue's score is the sum of its signals. Closed issues score −50 unless a timer is running on them. Ties are broken by `updatedAt`, newest first.

- [ ] Add `listTimeEntryIssueIds`, `listWatchedIssues` and `listActivityIssueIds` to `redmine-client.js`, next to `listIssues`
- [ ] Activity feed: parse the Atom XML on the server and keep **only the issue ids** from each entry's link. Discard titles, summaries and content without storing or logging them
- [ ] Activity feed: send the key in the `X-Redmine-API-Key` header. If the instance only accepts `?key=` for Atom, **skip this signal** and ship without it (see open questions)
- [ ] Get the user's own Redmine id once from `/users/current.json` and keep it in the existing per-user TTL cache
- [ ] Fetch the slim fields for every id the signals found with one batched `listIssuesByIds` call, capped at 100
- [ ] Give each signal its own 6-second timeout. A signal that fails or times out is dropped and the response sets `partial: true`. The method only errors if every signal fails
- [ ] Remove dismissed ids (Task A3) **before** the cap, so dismissing never leaves the list short. Skip this step when `includeDismissed` is true
- [ ] Cache the merged result per user for 90 seconds in `redmine-cache.js`. Clear it when the user pins, dismisses, logs time, links or unlinks their account
- [ ] Put the scoring in a pure function, `scoreRelevantIssues(signals)`, so it can be unit-tested without Redmine

## Task A2: `redmine.issues.search`

The server decides what kind of query it got, then makes exactly one bounded Redmine call. Searches never return more than 25 issues.

| Query | Example | Redmine call |
| --- | --- | --- |
| Issue number | `#1234` or `1234` | `GET /issues/1234.json` |
| Pasted Redmine URL | `https://redmine.example.org/issues/1234` | Take the id and treat it as `#1234`. Only accept URLs whose host matches the user's linked instance |
| Assignee | `@alex` | Match the name against members of the user's own projects (the cached project-members lookup), then `/issues.json?assigned_to_id=<id>&status_id=open&limit=25` |
| Plain text | `login timeout` | `/search.json?q=…&issues=1&titles_only=1&open_issues=1&limit=25`, then `listIssuesByIds` for the slim fields |

- [ ] Write a pure `parseRedmineQuery(query, baseUrl)` that returns `{ kind, value }`, and unit-test it
- [ ] Reject queries under 3 characters, except issue numbers
- [ ] Plain text: always use `titles_only=1`, so matches never come from descriptions or notes
- [ ] Plain text: throw away the `description` excerpt that `/search.json` returns. Resolve the result ids through `listIssuesByIds`, so search returns the same `SlimIssue` shape as everything else
- [ ] Assignee: if the name matches more than one person, return an empty list with `kind: 'assignee'`. Part B then asks the user to type more of the name. Never fall back to a Redmine-wide user lookup, because `/users.json` is admin-only
- [ ] `#id` for an issue the user cannot see: return an empty list, the same as an issue that does not exist, so the result reveals nothing
- [ ] Search results **include** dismissed issues. Dismissing only affects suggestions (see Task A3)

## Task A3: Pins and dismissals

One new collection stores TimeHuddle's own preferences about Redmine issues. It holds ids and dates only, never issue content.

```
RedmineIssuePrefs {
  userId,
  issueId,                  // Redmine issue id (number)
  state: 'pinned' | 'dismissed',
  assignedToMeAtDismissal,  // boolean, dismissals only
  updatedAt
}
```

**Dismissal rules (agreed)**

1. A user can dismiss any suggestion, including issues assigned to them.
2. A dismissal only hides the issue from **that user's search suggestions dropdown**. It never calls Redmine, never affects other users, search results, timers, timesheets or the Tickets page table.
3. A dismissal expires **15 days** after `updatedAt`. After that the issue is suggested again, but only if it still scores as relevant.
4. Dismissing the same issue again restarts the 15 days.
5. If the issue becomes assigned to the user after they dismissed it, the dismissal is cleared straight away.
6. Pinning a dismissed issue replaces the dismissal. Setting the state to `null` removes the preference (Undo and Restore).

**Tasks**

- [x] Create the collection with a unique index on `{ userId, issueId }`
- [x] Add a TTL index on `updatedAt` with `expireAfterSeconds: 1296000` (15 days) and `partialFilterExpression: { state: 'dismissed' }`, so pins are never deleted
- [x] MongoDB's TTL job runs about once a minute, so also filter out dismissals older than 15 days at read time. The expiry is then exact
- [x] Rule 5: on dismiss, record whether the issue was assigned to the user at that moment. When building the relevant list, clear any dismissal where that was `false` and the issue is now assigned to them
- [x] Implement `redmine.prefs.set` and `redmine.prefs.listDismissed` (see the contract). `listDismissed` resolves titles through `listIssuesByIds` at read time
- [x] Validate that `issueId` is a positive integer, reusing `REDMINE_ID` from `ticket-refs.js`
- [x] Cap each user at 500 dismissals and remove the oldest first, so the collection cannot grow without limit
- [x] Starting a timer on a Redmine issue pins it automatically. Hook this into the existing timer-start path
- [x] Unlinking the Redmine account deletes all of that user's prefs

**What changed on the way in**

- **The six rules live in one pure function, `partitionIssuePrefs`** (`redmine-prefs-core.js`), which turns a user's rows into `{ pinnedIds, dismissedIds, reviveIds }`. The first draft of this task implied a Mongo selector per rule — one for live dismissals, one for the reassignment sweep, one for the pins. That would have been three statements of the same knowledge and none of them testable without a database. One query handed to one function is fewer round trips *and* the reason the rules have tests at all (`tests/redmine-prefs-core.test.ts`, one per rule).
- **Rule 5 is applied on the read that notices it.** `readIssuePrefs` deletes the revived dismissals and leaves them out of `dismissedIds` in the same call, so the relevant list is correct immediately rather than on the call after.
- **A dismissal asks Redmine whether the issue is already the user's**, and on failure assumes **yes**. Recording "no" when we cannot tell would let the reassignment rule fire on the next list build and undo the dismissal the user just made; assuming "yes" makes it stick for its 15 days, which is what they asked for.
- **`REDMINE_ID` became `isRedmineIssueId(value)`, exported from `ticket-refs.js`**, and the id guard in `redmine-issue-methods.js` now calls it too. The rule was previously written out three times. `redmine.prefs.set` also *coerces* to a number rather than only checking, so an id arriving as `"42"` over REST cannot become a string row that `$in` will never match again.
- **`requireRedmineAccount` moved to `redmine-account.js`.** Both method modules had their own copy, which meant the "Connect your Redmine account first." a user sees depended on which method they happened to hit.

## Task A4: Security hardening

The API key is already encrypted at rest with AES-256-GCM and never sent to the browser. These tasks close the remaining gaps. Every Redmine call goes through `redmineRequest`, so most fixes land in one place.

**Keep PHI out of logs**

- [ ] Review the request-failure logging added in `e0bb6b6`. Log the method, the path **without its query string**, the status code and the duration. Never log the full URL, the response body or request headers
- [ ] Never log search queries. A user may type a patient's name into the search box
- [ ] Keep the key out of every URL, including the Atom feed. Only send it in the `X-Redmine-API-Key` header

**Where requests can go**

- [ ] Set `redirect: 'manual'` on every Redmine request. Node's fetch keeps custom headers such as `X-Redmine-API-Key` when following a redirect to another host, so a redirect could hand the key to that host. Treat a 3xx as an error
- [ ] The per-user Redmine URL from `512ef7d` lets a user make the server call any address, including internal hosts and cloud metadata endpoints. In production, only allow hosts listed in a `REDMINE_ALLOWED_HOSTS` env var. Dev keeps today's behaviour
- [ ] Require `https://` in production and keep TLS certificate checks on

**Key handling**

- [ ] Prefix new ciphertexts with a version, e.g. `v1:iv:tag:data`. Accept unprefixed values as the old version, so existing links keep working
- [ ] Support a previous key (`REDMINE_ENCRYPTION_KEY_PREVIOUS`) for decrypting during a rotation, and re-encrypt with the current key on the next successful use

**Abuse limits**

- [ ] Add a `DDPRateLimiter` rule for `redmine.issues.search`: 20 calls per 10 seconds per user
- [ ] Add a rule for `redmine.issues.relevant`: 10 calls per minute per user (the 90-second cache absorbs normal use)

**Data minimisation**

- [ ] List and search responses only ever contain `SlimIssue` fields. Add a test that fails if `description`, `journals` or `custom_fields` appear
- [ ] Nothing Redmine returns is written to Mongo, apart from the ids in `RedmineIssuePrefs`

## Task A5: Remove the `all` scope, and backend tests

The `all` scope is what pulled the whole database, so it goes completely rather than being hidden.

- [ ] Delete `redmine.issues.list` and `VALID_SCOPES` in `redmine.js`, and the `scope` option of `listIssues` in `redmine-client.js`
- [ ] Coordinate with Part B: `redmineSource` and the `RedmineScope` type in `src/lib/api.ts` switch to `redmine.issues.relevant` with `includeDismissed: true` in the same PR, so nothing breaks in between

**Tests** (Vitest, in `meteor-backend/tests/`, next to the existing `redmine-*.test.ts` files)

- [ ] `scoreRelevantIssues`: ordering, closed-issue penalty, recency decay, merging several reasons onto one issue
- [ ] `parseRedmineQuery`: `#1234`, bare `1234`, URLs on the linked host, URLs on other hosts (rejected), `@name`, plain text, short input
- [ ] Atom parsing keeps ids only and drops all entry text
- [ ] A signal timing out returns the rest with `partial: true`
- [ ] Dismissals: the 15-day expiry, dismissing again restarts it, the reassignment rule, pin replaces dismissal, `includeDismissed` bypass
- [ ] Security: 3xx responses are not followed, disallowed hosts are refused, versioned and unversioned ciphertexts both decrypt, responses contain only `SlimIssue` fields
- [ ] `npm run test:all`, `npm run lint` and `npm run typecheck` all pass

## Acceptance criteria

- [ ] No code path can request Redmine issues without a filter (assigned, watcher, time entries, activity ids, pinned ids, or a search)
- [ ] `redmine.issues.relevant` returns at most 100 issues, and responds within 8 seconds on the enterprise instance even when one signal is slow
- [ ] Search returns at most 25 issues and never matches on descriptions or notes
- [ ] No issue content is written to Mongo. `RedmineIssuePrefs` holds ids, states, a boolean and dates only
- [ ] A dismissed issue is gone from that user's suggestions, still findable by search, and back after 15 days or on reassignment
- [ ] Logs contain no query strings, response bodies, search terms or API keys
- [ ] Redirects are not followed, and production refuses Redmine hosts outside the allowlist

## Open questions

- [ ] Which Redmine version is the enterprise instance on? `/search.json` needs 3.3 or later
- [ ] Does its Atom activity feed accept the API key as a header? If not, the activity signal is dropped for MVP2
- [ ] Is 14 days the right window for "recent" time entries and activity?

## Out of scope for MVP2

- Storing issue titles or content in TimeHuddle
- Webhooks or background sync from Redmine
- Searching across closed issues or across projects the user is not a member of
- Admin or shared service keys
