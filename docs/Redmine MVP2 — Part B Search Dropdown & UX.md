# Redmine MVP2 — Part B: Search Dropdown & UX

Sep 25, 2026 · @Shubhdeep Sarkar

## Overview

Part B turns the Tickets page search bar into the main way to find Redmine work. Clicking into it shows the user's most relevant issues right away. Typing narrows them down instantly, then adds matching issues from Redmine. The x on a row hides that suggestion. Part B owns everything under `src/` and `tests/e2e/`.

**What the user sees**

1. They focus the search bar. The top 8 relevant issues appear, each with a reason chip such as _Assigned_ or _Logged 2d ago_.
2. They type. The list filters instantly in the browser, with no network call.
3. After a short pause, a **More from Redmine** section adds server search results. Typing `#1234`, a pasted Redmine link or `@name` works too.
4. Enter opens the issue. A timer icon starts a timer, which also pins the issue.
5. The x hides a suggestion, and an _Undo_ toast appears.

**Dependency on Part A.** All data comes from the four methods in the API contract section of Redmine MVP2 — Part A: Backend & Security. **Part A has landed**, so no stub is needed: `redmineApi.issues.relevant`, `redmineApi.issues.search`, `redmineApi.prefs.set` and `redmineApi.prefs.listDismissed` are typed and callable in `src/lib/api.ts`, and the e2e fixtures in `tests/e2e/fixtures/redmine.ts` already answer all four.

**Part A's cleanup came with it.** Removing `redmine.issues.list` meant the Tickets table could not be left pointing at it, so the four checkboxes below about `src/lib/api.ts`, `redmineSource` and the scope control are already ticked — see Task A5. What remains for Part B is the dropdown itself, dismiss/undo/restore, the states, the text and the e2e tests. **Until it lands, MVP2 must not reach users**: the table now shows only the user's own work, and the search bar that was meant to replace the rest does not exist yet.

## Task B1: Dropdown states

The dropdown has two modes: suggestions when the input is empty, and filtered results with server search while typing.

| Input                                    | What shows                                                      | Data source                                       |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| Empty, on focus                          | Top 8 relevant issues, and a "Show more" link to the rest       | `redmine.issues.relevant`, loaded once and cached |
| 1–2 characters                           | The relevant list filtered by title, `#id`, project or assignee | Browser only                                      |
| 3+ characters, or `#`, a link or `@name` | The filtered list on top, then a **More from Redmine** section  | `redmine.issues.search`, after a 300 ms pause     |

- [ ] Check the `@mieweb/ui` catalog for a combobox or autocomplete before building one. Load the `mieweb-ui-design` skill first, as the repo requires
- [ ] Remove duplicates: an issue already in the top section does not appear again under More from Redmine
- [ ] Show Huddle tickets and Redmine issues in separate, labelled groups. Do not mix them in one ranked list
- [ ] Placeholder hint: _Search, #number, @person, or paste a link_
- [ ] Empty results: word the message by the `kind` the server returned, e.g. "No issue #1234, or you can't see it" or "More than one person matches @al. Type more of the name"

## Task B2: Result rows

Each row shows, left to right: `#id`, the title, the project, a reason chip, a timer icon, and the x.

| Reason from the server | Chip text                                                               |
| ---------------------- | ----------------------------------------------------------------------- |
| `running`              | Timer running                                                           |
| `assigned`             | Assigned                                                                |
| `logged`               | Logged 2d ago (from `lastTimeLoggedAt`, formatted in the user's locale) |
| `activity`             | Recent activity                                                         |
| `watching`             | Watching                                                                |
| `pinned`               | Pinned                                                                  |

- [ ] Show only the strongest reason as a chip. The server sends reasons in score order, so take the first
- [ ] **Enter** or a click on the row opens the issue's detail page in TimeHuddle
- [ ] The timer icon starts a timer through the existing timer flow. Part A pins the issue on the server, so the client only refreshes the list
- [ ] Rows from search results (More from Redmine) have no reason chip, and they get a **Pin** action in place of the x
- [ ] Render titles as plain text, never as HTML
- [x] Switch `redmineSource` in `src/features/tickets/sources/redmineSource.ts` to `redmine.issues.relevant` with `includeDismissed: true`, so the Tickets table shows the relevant set and is not affected by dismissals — **done in Part A's Task A5**, which had to remove `redmine.issues.list` and could not leave the table pointing at it

## Task B3: Dismiss, undo and restore

The x hides an issue from **that user's search suggestions only**. It changes nothing in Redmine, in other users' views, in search results, or in the Tickets table. The server handles the 15-day expiry and the reassignment rule, so the client only calls `redmine.prefs.set`.

**Behaviour**

- [ ] Clicking the x removes the row at once and calls `redmine.prefs.set({ issueId, state: 'dismissed' })`. Do not ask for confirmation
- [ ] Show a toast: _Hidden #1234 · Undo_, for 6 seconds. Undo calls `redmine.prefs.set({ issueId, state: null })` and puts the row back where it was
- [ ] If the call fails, put the row back and show an error toast
- [ ] After dismissing, fill the empty slot from the rest of the cached relevant list, so the dropdown stays at 8 rows
- [ ] Add **Hidden suggestions** to the Redmine card in Settings. It lists `redmine.prefs.listDismissed` with a Restore button on each row, and says that hidden issues come back on their own after 15 days

**Click handling**

- [ ] The x's click must not select the row or close the dropdown. Stop the event from reaching the row
- [ ] Call `preventDefault()` on the x's `mousedown`, so the search input keeps focus

**Keyboard and screen readers**

In the accessible combobox pattern, rows cannot contain their own buttons. So the x is for the mouse, and the keyboard gets a shortcut.

- [ ] The x has `tabIndex={-1}` and `aria-hidden="true"`
- [ ] **Delete** or **Shift+Delete** on the highlighted row hides it, the same shortcut browsers use to remove autocomplete entries
- [ ] Each row's `aria-describedby` mentions the shortcut, e.g. "Press Delete to hide this suggestion"
- [ ] Announce the toast through an `aria-live="polite"` region
- [ ] Up and Down move through rows, Enter opens, Escape closes, and `aria-activedescendant` tracks the highlighted row

## Task B4: Requests, loading states and caching

The dropdown should never show results for an older query, and should never go blank while waiting.

- [ ] Wait 300 ms after the last keystroke before calling search. Issue numbers and pasted links search straight away
- [ ] Tag each search with an increasing request number and ignore any response that is not for the latest one
- [ ] While search runs, keep showing the local results with a small spinner in the More from Redmine header
- [ ] `partial: true` on the relevant list: show the list plus a quiet note, "Some Redmine results are still unavailable"
- [ ] Not connected: one row linking to Settings, "Connect Redmine to see your issues"
- [ ] Redmine unreachable or timed out: keep the local results and show "Redmine didn't respond. Try again" with a retry
- [ ] `too-many-requests`: show nothing extra. The next keystroke retries
- [ ] Keep the relevant list in the existing module-level cache, keyed by user id. Clear it on sign-out, pin, dismiss, undo, restore and timer start
- [ ] Keep search results in memory only, for the life of the dropdown. **Never write issues or search text to `localStorage`, `sessionStorage`, the URL or analytics.** A search term may be a patient's name

## Task B5: Cleanup, text, release note and e2e tests

**Remove the scope toggle**

- [x] Delete the `RedmineScope` type and `redmineApi.issues.list` in `src/lib/api.ts`, and add the four new methods — **done in Part A's Task A5.** All four are typed and callable; `RedmineRelevantIssue`, `RedmineSearchKind` and `RedmineIssuePrefState` are there to build the dropdown against
- [x] Remove the "mine / all" scope control from the Tickets page and `redmineScope` from the source context — **done in Part A's Task A5**, including the reload trigger in `useUnifiedTickets`
- [x] Ship this in the same PR as Part A's removal of `redmine.issues.list` — it did

**Text and translation**

- [ ] Every new string goes through the app's translation setup: the placeholder, reason chips, section headers, toasts, empty and error messages, and the Settings list
- [ ] Format "Logged 2d ago" with `Intl.RelativeTimeFormat` in the user's locale
- [ ] Check the dropdown in a right-to-left language: the x and the timer icon swap sides

**Release note**

- [ ] Add a note in `release-notes/` following its README. Explain that the Redmine list now shows _your_ issues, not everything, and how to find anything else with search, `#number` or `@person`

**E2E tests** (`tests/e2e/redmine/`)

- [ ] Focus shows the relevant list with reason chips, in score order
- [ ] Typing filters locally, then More from Redmine appears with no duplicates
- [ ] `#1234`, a pasted link and `@name` each find the right issue
- [ ] Dismiss removes the row, Undo brings it back, and the row still shows up in search
- [ ] Delete on a highlighted row dismisses it. Keyboard-only navigation works end to end
- [ ] Restore in Settings brings a hidden issue back
- [ ] Not connected, partial and error states render
- [x] Update `me-assignee-filter.spec.ts` and `sources-unified.spec.ts`, which use the removed scope — **done in Part A's Task A5**; the fixture's disconnected defaults now cover `issues.search` and both prefs methods too, so a new spec that forgets to stub one gets a coherent disconnected app rather than a live call
- [ ] `npm run test:all`, `npm run lint`, `npm run typecheck` and `npm run format` all pass, plus a smoke test at `http://localhost:3000`

## Acceptance criteria

- [ ] Focusing the empty search bar shows up to 8 relevant issues without typing
- [ ] Local filtering responds on every keystroke with no network call
- [ ] Server search results appear under More from Redmine, with no duplicates and no results from an older query
- [ ] The x and the Delete key both hide a suggestion, Undo restores it, and a hidden issue is still found by search
- [ ] Hidden issues can be restored from Settings
- [ ] Dismissing has no effect on the Tickets table, timers or timesheets
- [ ] The dropdown works with the keyboard alone and announces changes to screen readers
- [ ] No issue data or search text is stored in the browser or put in URLs
- [ ] The scope toggle is gone, and a release note ships

## Out of scope for MVP2

- Advanced search syntax such as combining `@name` with text, or filtering by project or status
- Offline search
- Dismissing Huddle tickets (Redmine suggestions only)
- Changing the Tickets table's layout beyond the new data source
