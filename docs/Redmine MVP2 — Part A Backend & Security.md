# Redmine MVP2 — Part A: Backend & Security

Sep 25, 2026 · @Shubhdeep Sarkar

## Overview

Part A replaces the "fetch every issue" call with two small, filtered server methods, adds a per-user preferences store (pins and dismissals, ids only), and hardens how TimeHuddle talks to Redmine. It owns everything under `meteor-backend/server/`.

Today `listIssues` with `scope: 'all'` returns every issue the user's key can see. On the enterprise instance that is a very large set, and issue titles and descriptions can contain PHI. After MVP2, TimeHuddle only ever asks Redmine for issues that are relevant to the user, or for issues the user explicitly searched for.

**How the work is split**

| Part                             | Owns                                                                                  | Depends on                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A: Backend & Security (this doc) | Meteor methods, Redmine client calls, Mongo collection, security fixes, backend tests | Nothing. Can start now                                         |
| B: Search Dropdown & UX          | Search bar dropdown, dismiss and undo, states, i18n, release note, e2e tests          | The API contract below. Can build against a stub until A lands |

The API contract in the next section is the handshake between the two parts. Change it only by agreement.

## API contract (shared with Part B)

Four new Meteor methods. All of them use the caller's own Redmine key, and all return the same slim issue shape.

| Method                        | Input                                                 | Returns                                                                 |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `redmine.issues.relevant`     | `{ includeDismissed?: boolean }`                      | `{ connected, baseUrl, issues: RelevantIssue[], partial }`              |
| `redmine.issues.search`       | `{ query: string }`                                   | `{ connected, baseUrl, kind, issues: SlimIssue[] }`                     |
| `redmine.prefs.set`           | `{ issueId, state: 'pinned' \| 'dismissed' \| null }` | `{ ok: true }`. `null` clears the preference (used by Undo and Restore) |
| `redmine.prefs.listDismissed` | none                                                  | `{ issues: SlimIssue[] }` for the Restore list                          |

**Shapes**

- `SlimIssue`: `id`, `subject`, `project { id, name }`, `status { id, name, isClosed }`, `priority { id, name }`, `assignedTo { id, name } | null`, `tracker { id, name }`, `createdAt`, `updatedAt`. **No description, notes or custom fields.**
  - **Settled in code:** this is exactly the DTO `toIssue` in `redmine-issues.js` already returns, so the backend has one issue shape rather than two. It is slightly wider than this doc first sketched — ids on `status` and `priority`, plus `tracker` and `createdAt` — and that width is what makes Task A5 possible: the Tickets table reads all four through `redmineSource`, so a narrower shape would have broken it the moment `redmine.issues.list` went away.
- `RelevantIssue`: `SlimIssue` plus `reasons: ('running' | 'assigned' | 'logged' | 'activity' | 'watching' | 'pinned')[]`, `score: number` and `lastTimeLoggedAt?: string`. The list arrives already sorted. Dismissed issues are excluded unless includeDismissed is true: the search dropdown leaves it off, and the Tickets page table turns it on, because dismissals only affect the dropdown.
- `partial: true` means at least one signal timed out. Part B shows the list anyway.
- `kind` on search echoes how the query was read: `'id' | 'url' | 'assignee' | 'text'`. Part B can use it for the empty-state message.

**Errors** reuse the existing `toRedmineMeteorError` codes, plus `too-many-requests` from the rate limiter.

The old `redmine.issues.list` method is removed (see the scope task below).

## Task A1: `redmine.issues.relevant`

The method runs one small, filtered Redmine query per signal, all in parallel. It merges the results by issue id, scores them, and returns at most 100.

| Signal               | Redmine call                                                                   | Score                                    |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| Timer running on it  | TimeHuddle's own running `WorkItem` (no Redmine call)                          | 100                                      |
| Assigned to me, open | `/issues.json?assigned_to_id=me&status_id=open&sort=updated_on:desc&limit=100` | 60                                       |
| I logged time on it  | `/time_entries.json?user_id=me&from=<14 days ago>&limit=100` → issue ids       | 50, minus 2 per day since the last entry |
| My activity feed     | `/activity.atom?user_id=<my id>&from=<14 days ago>` → issue ids only           | 40, minus 2 per day                      |
| Watching, open       | `/issues.json?watcher_id=me&status_id=open&limit=50`                           | 20                                       |
| Pinned in TimeHuddle | Pin ids from Task A3 → `/issues.json?issue_id=…&status_id=*`                   | 30                                       |

An issue's score is the sum of its signals. Closed issues score −50 unless a timer is running on them. Ties are broken by `updatedAt`, newest first.

- [x] Add `listTimeEntryIssueIds`, `listWatchedIssues` and `listActivityIssueIds` to `redmine-client.js`, next to `listIssues` — plus `listAssignedIssues`, so every signal has a named helper instead of a query string at the call site
- [x] Activity feed: parse the Atom XML on the server and keep **only the issue ids** from each entry's link. Discard titles, summaries and content without storing or logging them
- [x] Activity feed: send the key in the `X-Redmine-API-Key` header. If the instance only accepts `?key=` for Atom, **skip this signal** and ship without it (see open questions)
- [x] Get the user's own Redmine id once from `/users/current.json` and keep it in the existing per-user TTL cache
- [x] Fetch the slim fields for every id the signals found with one batched `listIssuesByIds` call, capped at 100
- [x] Give each signal its own 6-second timeout. A signal that fails or times out is dropped and the response sets `partial: true`. The method only errors if every signal fails
- [x] Remove dismissed ids (Task A3) **before** the cap, so dismissing never leaves the list short. Skip this step when `includeDismissed` is true
- [x] Cache the merged result per user for 90 seconds in `redmine-cache.js`. Clear it when the user pins, dismisses, logs time, links or unlinks their account
- [x] Put the scoring in a pure function, `scoreRelevantIssues(signals)`, so it can be unit-tested without Redmine

**What changed on the way in**

- **The whole list lives in `redmine-relevance.js`, and none of it touches Meteor.** The first shape of this had the signal gathering inside the Meteor method, where nothing about it could be tested — and the behaviour most worth testing is precisely the awkward one: a signal times out, and the list has to arrive anyway. The three things the list needs from Mongo (the caller's pins, whether a timer is running, which issues they have hidden) are now arguments, the last of them a callback, because the hidden set cannot be computed until Redmine has said what is assigned to the user. `redmine-suggestions.js` is left holding the plumbing: identity, the cache, and mapping an error to a client code.
- **`issueQuery` is the one door to `/issues.json`**, and it throws unless the query carries a narrowing parameter (`issue_id`, `assigned_to_id`, `watcher_id`, `author_id` or `project_id`). `status_id` deliberately does not count: "open issues only" is not a filter, it is most of the database. This is what makes the first acceptance criterion a property of the code rather than a promise about it.
- **The Atom parse keeps each entry's `<updated>` as well as its id.** The plan said "ids only", but the activity signal _decays_ — 40 points minus 2 a day — and there is nothing to measure that against without the entry's own date. A timestamp is not entry text: titles, summaries, content and author names are dropped inside `redmine-atom.js` before anything can score, cache, log or return them, and a test asserts the returned objects have no keys but `issueId` and `at`.
- **No XML parser was added.** Ids are read only out of `<link>` hrefs, and nothing but an integer and a parsed date leaves the module, so a mis-parse can drop or duplicate an id but cannot leak a word of an entry. Escaped markup in `content` cannot pose as a link element, and there is a test for that.
- **The user's own Redmine id usually costs no request.** `redmine.connect` already stores `redmineUserId` on the `redmine_links` row, so the activity signal reads it from there; `/users/current.json` is the cached fallback for rows written before it did. When the id cannot be found at all the activity signal is skipped rather than guessed at.
- **The batched resolve only fetches what the signals did not already return.** `assigned`, `watching` and `pinned` answer with whole issues, so the 100-id budget goes entirely to the ids that arrive bare from `logged` and the activity feed. If that one call fails the list is still served from the signals that did answer, marked `partial`.
- **A hidden issue is filtered twice** — out of the ids we bother to resolve, and again out of whatever Redmine answers with. "It is gone from my suggestions" is a promise to the user, and it should not rest on Redmine having replied with exactly the ids it was asked for. A test caught this.
- **A running timer does not automatically top the list**, because the score is a sum: an issue that is assigned _and_ logged today scores 110 against a running timer's 100. In practice the issue being timed carries those signals too, so it wins on the sum. Left as the doc specified.

## Task A2: `redmine.issues.search`

The server decides what kind of query it got, then makes exactly one bounded Redmine call. Searches never return more than 25 issues.

| Query              | Example                                   | Redmine call                                                                                                                                                   |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue number       | `#1234` or `1234`                         | `GET /issues/1234.json`                                                                                                                                        |
| Pasted Redmine URL | `https://redmine.example.org/issues/1234` | Take the id and treat it as `#1234`. Only accept URLs whose host matches the user's linked instance                                                            |
| Assignee           | `@alex`                                   | Match the name against members of the user's own projects (the cached project-members lookup), then `/issues.json?assigned_to_id=<id>&status_id=open&limit=25` |
| Plain text         | `login timeout`                           | `/search.json?q=…&issues=1&titles_only=1&open_issues=1&limit=25`, then `listIssuesByIds` for the slim fields                                                   |

- [x] Write a pure `parseRedmineQuery(query, baseUrl)` that returns `{ kind, value }`, and unit-test it
- [x] Reject queries under 3 characters, except issue numbers
- [x] Plain text: always use `titles_only=1`, so matches never come from descriptions or notes
- [x] Plain text: throw away the `description` excerpt that `/search.json` returns. Resolve the result ids through `listIssuesByIds`, so search returns the same `SlimIssue` shape as everything else
- [x] Assignee: if the name matches more than one person, return an empty list with `kind: 'assignee'`. Part B then asks the user to type more of the name. Never fall back to a Redmine-wide user lookup, because `/users.json` is admin-only
- [x] `#id` for an issue the user cannot see: return an empty list, the same as an issue that does not exist, so the result reveals nothing
- [x] Search results **include** dismissed issues. Dismissing only affects suggestions (see Task A3)

**What changed on the way in**

- **`searchIssues` returns ids, not results.** Throwing the `description` excerpt away is stated as a rule above, but a rule is easy to forget the next time someone adds a field. The client helper reduces `/search.json` to an array of integers before returning, so the excerpt and the title have nowhere to go and there is no second path for issue text to travel down.
- **A link to another instance is `{ kind: 'url', value: null }`**, not an error. It stays inside the agreed `kind` values and lets Part B say "that link is not for this Redmine" from the same empty-list response it already handles. A bare `@` reads as `{ kind: 'assignee', value: null }` for the same reason — the user has started an assignee query and has not typed the name yet.
- **`@name` is matched against project rosters, assembled and cached per user.** Redmine has no "users I can see" endpoint (`/users.json` is admin-only), so the roster is built from the memberships of the caller's own projects. That is one request per project, so it is bounded at **25 projects, 5 at a time**, and held for five minutes: without the bound, one keystroke from someone in a hundred projects would become a hundred simultaneous requests. A project whose memberships cannot be read is skipped rather than failing the search. See the open question below about whether 25 is enough on the enterprise instance.
- **An exact name wins outright.** `@Alex Kim` resolves to Alex Kim even when an Alex Kimura exists; without that rule the longer name would make the shorter one permanently unsearchable.
- **Redmine's own search order is preserved.** `/issues.json` does not keep it, so the slim issues are put back into the order the ids arrived in — relevance is the useful order for a search, and it is the server's to keep.
- **`toAssignableUsers` was lifted out of `toFormOptions`** in `redmine-issues.js`. The M6 create form and the `@name` search need the same answer about a memberships list, and it should not be written twice.

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

- **The six rules live in one pure function, `partitionIssuePrefs`** (`redmine-prefs-core.js`), which turns a user's rows into `{ pinnedIds, dismissedIds, reviveIds }`. The first draft of this task implied a Mongo selector per rule — one for live dismissals, one for the reassignment sweep, one for the pins. That would have been three statements of the same knowledge and none of them testable without a database. One query handed to one function is fewer round trips _and_ the reason the rules have tests at all (`tests/redmine-prefs-core.test.ts`, one per rule).
- **Rule 5 is applied on the read that notices it.** `readIssuePrefs` deletes the revived dismissals and leaves them out of `dismissedIds` in the same call, so the relevant list is correct immediately rather than on the call after.
- **A dismissal asks Redmine whether the issue is already the user's**, and on failure assumes **yes**. Recording "no" when we cannot tell would let the reassignment rule fire on the next list build and undo the dismissal the user just made; assuming "yes" makes it stick for its 15 days, which is what they asked for.
- **`REDMINE_ID` became `isRedmineIssueId(value)`, exported from `ticket-refs.js`**, and the id guard in `redmine-issue-methods.js` now calls it too. The rule was previously written out three times. `redmine.prefs.set` also _coerces_ to a number rather than only checking, so an id arriving as `"42"` over REST cannot become a string row that `$in` will never match again.
- **`requireRedmineAccount` moved to `redmine-account.js`.** Both method modules had their own copy, which meant the "Connect your Redmine account first." a user sees depended on which method they happened to hit.

## Task A4: Security hardening

The API key is already encrypted at rest with AES-256-GCM and never sent to the browser. These tasks close the remaining gaps. Every Redmine call goes through `redmineRequest`, so most fixes land in one place.

**Keep PHI out of logs**

- [x] Review the request-failure logging added in `e0bb6b6`. Log the method, the path **without its query string**, the status code and the duration. Never log the full URL, the response body or request headers
- [x] Never log search queries. A user may type a patient's name into the search box
- [x] Keep the key out of every URL, including the Atom feed. Only send it in the `X-Redmine-API-Key` header

**Where requests can go**

- [x] Set `redirect: 'manual'` on every Redmine request. Node's fetch keeps custom headers such as `X-Redmine-API-Key` when following a redirect to another host, so a redirect could hand the key to that host. Treat a 3xx as an error
- [x] The per-user Redmine URL from `512ef7d` lets a user make the server call any address, including internal hosts and cloud metadata endpoints. In production, only allow hosts listed in a `REDMINE_ALLOWED_HOSTS` env var. Dev keeps today's behaviour
- [x] Require `https://` in production and keep TLS certificate checks on

**Key handling**

- [x] Prefix new ciphertexts with a version, e.g. `v1:iv:tag:data`. Accept unprefixed values as the old version, so existing links keep working
- [x] Support a previous key (`REDMINE_ENCRYPTION_KEY_PREVIOUS`) for decrypting during a rotation, and re-encrypt with the current key on the next successful use

**Abuse limits**

- [x] ~~Add a `DDPRateLimiter` rule for~~ Limit `redmine.issues.search`: 20 calls per 10 seconds per user
- [x] Add a rule for `redmine.issues.relevant`: 10 calls per minute per user (the 90-second cache absorbs normal use)

**Data minimisation**

- [x] List and search responses only ever contain `SlimIssue` fields. Add a test that fails if `description`, `journals` or `custom_fields` appear
- [x] Nothing Redmine returns is written to Mongo, apart from the ids in `RedmineIssuePrefs`

**What changed on the way in**

- **`DDPRateLimiter` would have guarded a door this app does not use.** Meteor applies it in `_livedata_method`, the DDP _message_ handler. Every call from TimeHuddle arrives through meteor-wormhole's REST bridge, which invokes the method with `Meteor.callAsync` on the server — a path that never reaches `_livedata_method`. A rule would have looked like a limit and enforced nothing. The limit is therefore called from inside the two methods (`rate-limit.js`), at the agreed rates, which covers REST, MCP and DDP with one mechanism and cannot be sidestepped by arriving a different way. The error code is still `too-many-requests`, as the contract promises. The counter is in-process, which is honest for a single Meteor process under PM2 and is the thing to revisit if this is ever scaled horizontally.
- **The failure log moved from `toRedmineMeteorError` to `redmineRequest`.** The error mapper never knew the method, the path or the duration, so it could not have logged them; the request function knows all four and is also the only place that can log a _network_ failure, which never reaches the mapper at all. `toRedmineMeteorError` now only maps. The path is logged with its query string cut off, which is what keeps a search term — possibly a patient's name — out of the log, and there is a test asserting exactly which six keys the log line carries.
- **`REDMINE_BASE_URL`'s own host is always allowed** without appearing in `REDMINE_ALLOWED_HOSTS`. It is the deployment's own configuration rather than user input, and requiring it to be repeated would have broken every existing production install the moment this shipped.
- **The host check runs at link time as well as per request.** A user whose URL cannot be served is told while they are looking at the field, instead of meeting "Redmine is unreachable" on the Tickets page later.
- **Redirects are refused before the body is read.** A 3xx is turned into an error carrying `redirected: true` without calling `readErrorMessages`, so a redirect cannot be used to make the server read a body from an unexpected host either.
- **A rotated key is re-encrypted on decrypt, not on the next Redmine call.** Decrypting successfully _is_ a successful use of the previous key, and doing it there means one write per user per rotation in one place (`findRedmineAccount`) rather than a hook on every call site. The write is fire-and-forget: a read path must not fail because a re-encrypt did, and the next read simply tries again.
- **The data-minimisation test asserts the exhaustive key list of `toIssue`**, not the absence of three named fields. Every list and search response is built from that one shape, so a future field addition has to change the test deliberately — whereas a test that only banned `description`, `journals` and `custom_fields` would have said nothing about `attachments` or `watchers`.
- **New env vars are documented where they are set**: `REDMINE_ALLOWED_HOSTS` and `REDMINE_ENCRYPTION_KEY_PREVIOUS` in both `docker-compose.yml` and `ecosystem.config.cjs`.

## Task A5: Remove the `all` scope, and backend tests

The `all` scope is what pulled the whole database, so it goes completely rather than being hidden.

- [x] Delete `redmine.issues.list` and `VALID_SCOPES` in `redmine.js`, and the `scope` option of `listIssues` in `redmine-client.js` — `listIssues` went with it, since `issueQuery` refuses an unfiltered query and there was nothing left for it to express
- [x] Coordinate with Part B: `redmineSource` and the `RedmineScope` type in `src/lib/api.ts` switch to `redmine.issues.relevant` with `includeDismissed: true` in the same PR, so nothing breaks in between

**Tests** (Vitest, in `meteor-backend/tests/`, next to the existing `redmine-*.test.ts` files)

- [x] `scoreRelevantIssues`: ordering, closed-issue penalty, recency decay, merging several reasons onto one issue — `tests/redmine-relevance.test.ts`
- [x] `parseRedmineQuery`: `#1234`, bare `1234`, URLs on the linked host, URLs on other hosts (rejected), `@name`, plain text, short input — `tests/redmine-query.test.ts`, plus `matchAssignees`
- [x] Atom parsing keeps ids only and drops all entry text — `tests/redmine-atom.test.ts`
- [x] A signal timing out returns the rest with `partial: true` — `tests/redmine-relevance.test.ts`
- [x] Dismissals: the 15-day expiry, dismissing again restarts it, the reassignment rule, pin replaces dismissal, `includeDismissed` bypass — `tests/redmine-prefs-core.test.ts`
- [x] Security: 3xx responses are not followed, disallowed hosts are refused, versioned and unversioned ciphertexts both decrypt, responses contain only `SlimIssue` fields — `tests/redmine-hardening.test.ts`, `tests/redmine-crypto.test.ts`, `tests/redmine-issues.test.ts`
- [x] `npm run test:all`, `npm run lint` and `npm run typecheck` all pass

**What changed on the way in**

- **`listIssues` is gone, not just its `scope`.** Once `issueQuery` refuses a query that narrows nothing, "list issues" has nothing left to mean, and every caller wants one of the named signal helpers instead. Removing it is what turns the first acceptance criterion into something the code enforces rather than something the reviewer has to check.
- **Part B's two files were switched here, as agreed.** `src/lib/api.ts` loses `RedmineScope` and `redmineApi.issues.list` and gains all four methods with their types; `redmineSource.ts` reads `redmine.issues.relevant(true)`; `redmineScope` is gone from the source context, the Tickets page and `useUnifiedTickets`. No UI was built — the dropdown is Part B's. The four typed wrappers are there so Part B can build against the real contract instead of a stub.
- **The e2e mocks had to move with it.** `tests/e2e/fixtures/redmine.ts` and three specs stubbed `issues.list`; they now stub `issues.relevant` (and the fixture's disconnected defaults cover `issues.search` and both prefs methods, so a Part B spec that forgets to stub one gets a coherent disconnected app rather than a live call). The `sources-unified` test that asserted `{ scope: 'all' }` now asserts `{ includeDismissed: true }`, which is the same promise in MVP2's terms: the table shows the user's work and a hidden _suggestion_ does not remove a _row_.
- **`tests/redmine.test.ts` gained a test that `redmine.issues.list` is really gone**, so a future reviewer does not have to take the deletion on trust, plus REST-level coverage of the new methods' auth, validation and not-connected paths.
- **The two-signal caveat on a fresh instance.** Nothing here exercises a _live_ Redmine — the integration tests cover the deterministic paths, and the signals are covered against a stubbed `fetch`. The open questions below are what a run against the enterprise instance is for.

## Verification

| Gate                                                                            | Result                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `meteor-backend` unit + integration (`vitest run`)                              | 437 passed, 30 files                                                               |
| `npm run test:unit` (frontend)                                                  | 217 passed, 22 files                                                               |
| `npm run typecheck`, `meteor-backend` `tsc --noEmit`                            | clean                                                                              |
| `npm run lint`, `eslint server/`                                                | clean (37 pre-existing warnings in `server/`, none in new files)                   |
| `e2e/redmine/sources-unified.spec.ts`, `e2e/tickets/me-assignee-filter.spec.ts` | 15 passed                                                                          |
| REST reachability                                                               | test Meteor backend restarted, all four methods answer through the wormhole bridge |

The test Meteor backend was restarted before the integration run, so those 24 Redmine tests exercised the new code rather than the build that was already loaded.

## Acceptance criteria

- [x] No code path can request Redmine issues without a filter (assigned, watcher, time entries, activity ids, pinned ids, or a search) — enforced by `issueQuery`, which throws on an unfiltered query; `listIssues` is deleted
- [x] `redmine.issues.relevant` returns at most 100 issues, and responds within 8 seconds on the enterprise instance even when one signal is slow — the cap and the 6-second per-signal bound are in code and tested; **the 8-second figure on the enterprise instance is still unmeasured** (see Still to verify)
- [x] Search returns at most 25 issues and never matches on descriptions or notes — `titles_only=1`, and `searchIssues` returns ids so the excerpt cannot travel
- [x] No issue content is written to Mongo. `RedmineIssuePrefs` holds ids, states, a boolean and dates only
- [x] A dismissed issue is gone from that user's suggestions, still findable by search, and back after 15 days or on reassignment
- [x] Logs contain no query strings, response bodies, search terms or API keys
- [x] Redirects are not followed, and production refuses Redmine hosts outside the allowlist

## Still to verify against the enterprise instance

Everything above is covered by unit, integration and e2e tests, but nothing in
Part A has spoken to the real Redmine. These need one session against it:

- [ ] The relevant list responds within 8 seconds with a warm and a cold cache
- [ ] `/search.json` exists and honours `titles_only=1` (needs Redmine 3.3+)
- [ ] `/activity.atom` accepts the key as a header. If it does not, the signal drops itself and the list comes back `partial` — no code change either way
- [ ] `@name` finds colleagues, and the 25-project roster bound is not hit

## Shipping constraint (read before releasing Part A on its own)

**Part A must not reach users without Part B.** It removes the only way to see a
Redmine issue that is not the user's own — the Tickets table used to list
everything the key could see — and the replacement is Part B's search bar. On
this branch alone the table simply shows fewer issues than it did, with nothing
offered in their place.

For the same reason the **release note is Part B's**, and correctly so: the note
has to explain the search bar, `#number` and `@person` in the same breath as the
narrower list, and there is nothing to point at until Part B lands. Add it to
`release-notes/1.0.3.md` — that version already has a note, and its README says
to add to an existing one rather than create a second file.

## Open questions

- [ ] Which Redmine version is the enterprise instance on? `/search.json` needs 3.3 or later
- [ ] Does its Atom activity feed accept the API key as a header? If not, the activity signal is dropped for MVP2. **Nothing in the code needs to change either way**: a 401 on the feed drops that one signal and the list is served `partial`, so this is a question about how good the list is, not about whether it works
- [ ] Is 14 days the right window for "recent" time entries and activity?
- [ ] **New.** Do users on the enterprise instance belong to more than 25 projects? That is the bound on the `@name` roster, and a user past it would find colleagues from their least-numbered projects only. Raising it costs one request per project on a cold five-minute cache

## Out of scope for MVP2

- Storing issue titles or content in TimeHuddle
- Webhooks or background sync from Redmine
- Searching across closed issues or across projects the user is not a member of
- Admin or shared service keys
