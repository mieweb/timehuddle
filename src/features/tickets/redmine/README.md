# Redmine issue dialogs (Milestone 6)

Creating and editing Redmine issues from the Tickets page.

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
