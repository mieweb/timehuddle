# Redmine on the Tickets page

Two things live here: the dialogs for creating and editing Redmine issues
(Milestone 6), and the search suggestions that let a user find Redmine issues
from the Tickets search bar (MVP2 Part B).

## Issue dialogs (Milestone 6)

| File                          | Role                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `RedmineIssueCreateModal.tsx` | "New Ticket → Redmine issue": project, tracker, subject, description, assignee (defaults to the user), priority |
| `RedmineIssueEditModal.tsx`   | Row ⋮ → "Edit Ticket" / "Change Status" on a Redmine row: status, priority, assignee, description               |
| `redmineForm.ts`              | Pure helpers both dialogs share: `Select` options, id parsing, error and read-back messages                     |

**How writes work.** Every call runs on the server under the user's own
personal Redmine API key (`meteor-backend/server/redmine-issue-methods.js`), so
Redmine enforces their role and workflow and records them as the author. The
edit dialog only offers the status changes Redmine reports as allowed, sends
only the fields that changed, and is refused as **stale** if the issue changed
in Redmine after the dialog opened. Every write is confirmed by reading the
issue back.

**What these dialogs don't do.** They don't delete issues, handle tags or
custom fields, or persist anything: the list refetches from Redmine after a
write (`invalidateRedmineCache` in `../sources/redmineSource.ts`).

## Search suggestions (MVP2 Part B)

The Tickets search bar filters the table and, as the same input, opens a
dropdown of Redmine issues: **Suggested for you** on focus, narrowed as the
user types, then **More from Redmine** from a server search. The rules behind
it are in [`docs/redmine-design.md`](../../../../docs/redmine-design.md).

The dropdown is Redmine-only, but the `@person` and `#ref` prefixes are not:
the table filter (`matchesSearch` in [`../ticketFilters.ts`](../ticketFilters.ts))
reads them too, for rows from every source.

| File                           | Role                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `RedmineSuggestions.tsx`       | The search input and its dropdown: downshift's `useCombobox` around `@mieweb/ui` `Input`, rows, shortcuts  |
| `useRedmineSuggestions.ts`     | Data: the suggestion list (cached per user), debounced search that ignores stale answers, dismiss and undo |
| `suggestions.ts`               | Pure rules: local filtering, when to search the server, empty-result wording, the reason chip              |
| `suggestionStrings.ts`         | Every user-facing string, in one place for translation                                                     |
| `RedmineHiddenSuggestions.tsx` | **Settings → Redmine → Hidden suggestions**: the dismissed issues, with Restore                            |

**Why downshift and not `@mieweb/ui`'s `Autocomplete`.** `Autocomplete` renders
each row as a `<button>`, so a row cannot hold the timer and hide actions, and
it keeps the highlighted row private, so Delete-to-hide cannot be added.
downshift supplies only the combobox keyboard and ARIA wiring; everything
visible is still `@mieweb/ui`.

**Two relevant-list calls, on purpose.** The table asks
`redmine.issues.relevant` with `includeDismissed: true`; the dropdown asks
without it. Hiding a suggestion must never remove a table row.

**Nothing is stored in the browser.** Suggestions and search results are held
in memory for the session only — never `localStorage`, the URL or analytics.
A search term may be a patient's name.
