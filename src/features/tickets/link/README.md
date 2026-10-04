# Linking a ticket to an external issue

A TimeHuddle ticket can be linked to one Redmine issue (#636). The ticket stays
a TimeHuddle ticket; the link says which Redmine issue it stands for.

| File                          | Role                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `TicketConnectDialog.tsx`     | "Connect to…": an existing Redmine issue, a new one created from the ticket, or a GitHub URL |
| `LinkedIssueCard.tsx`         | The "Linked issue" card on the ticket page, with Change and Unlink                           |
| `TicketLinkConfirmDialog.tsx` | Confirms an unlink                                                                           |
| `linkWarnings.ts`             | What a link change means for time already logged                                             |
| `useLinkStatus.ts`            | Reads the lock and the viewer's time figures when a dialog opens                             |
| `linkErrors.ts`               | Turns a refused link into a message                                                          |
| `ticketLinkStrings.ts`        | All user-facing text                                                                         |

**What is stored.** Only `{ source, id }` on the ticket (`linkedIssue`), written
by `tickets.link` / `tickets.unlink` in `meteor-backend/server/ticket-links.js`
(rules in `ticket-link-core.js`, the lock in `ticket-lock.js`).
The issue's subject, status and assignee are never stored: each viewer reads
them from Redmine with their own key. A teammate without access sees the plain
ticket.

**The lock.** While anyone has a timer running on a linked ticket, the server
refuses changes to its link and its fields (`ticket-locked`, with whose timer it
is). The ticket page reads `tickets.linkStatus` to show that before anyone
tries. An unlinked ticket is never locked.

**Time.** A timer session on a linked ticket is stamped with the issue it was
logged under, and is offered in the Redmine push like time logged on the issue
itself. Relinking never moves time that already exists; `linkWarnings.ts` says
so, with the viewer's own figures, before a link is changed.

**In the table.** A linked issue is shown on the ticket that links to it, not as
a row of its own. That merge lives in `../sources/linkedTickets.ts`.

The GitHub URL is the ticket's older `github` field and is independent of the
link: a ticket may have both.
