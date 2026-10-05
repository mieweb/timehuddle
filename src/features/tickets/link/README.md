# Linking a ticket to an external issue

A TimeHuddle ticket can be linked to one Redmine issue (#636). The ticket stays
a TimeHuddle ticket; the link says which Redmine issue it stands for.

| File                     | Role                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `TicketLinkFields.tsx`   | The one control for choosing a link: TimeHuddle only, GitHub, or Redmine (existing/new) |
| `ticketLinkForm.ts`      | That control's state, and when it is complete enough to save                            |
| `applyTicketLink.ts`     | Carries the choice out: link, unlink, set the GitHub URL, or create a Redmine issue     |
| `LinkedIssueSection.tsx` | The "Linked issue" section at the top of the ticket page: show, change, remove          |
| `linkWarnings.ts`        | What a link change means for time already logged                                        |
| `useLinkStatus.ts`       | Reads the lock and the viewer's time figures before a link is changed                   |
| `linkErrors.ts`          | Turns a refused link into a message                                                     |
| `ticketLinkStrings.ts`   | All user-facing text                                                                    |

**One control, two places.** `TicketLinkFields` is used by the New Ticket dialog
(`../TicketCreateModal.tsx`) and by `LinkedIssueSection`, so creating a ticket
and changing its link later are the same choice. There is no other dialog for
either.

**One link per ticket.** A ticket is TimeHuddle-only, on GitHub, or on Redmine.
Linking to Redmine clears a GitHub URL, and the server refuses a GitHub URL
while a Redmine link stands. A Redmine link is only ever removed through
`tickets.unlink`, which respects the lock and notifies teammates.

**What is stored.** Only `{ source, id }` on the ticket (`linkedIssue`), written
by `tickets.link` / `tickets.unlink` in `meteor-backend/server/ticket-links.js`
(rules in `ticket-link-core.js`, the lock in `ticket-lock.js`).
The issue's subject, status and assignee are never stored: each viewer reads
them from Redmine with their own key. A teammate without access sees the plain
ticket.

**The lock.** While anyone has a timer running on a linked ticket, the server
refuses changes to its link and its fields (`ticket-locked`, with whose timer it
is). The ticket page polls the cheap `tickets.lockStatus` to show that before anyone
tries. An unlinked ticket is never locked.

**Time.** A timer session on a linked ticket is stamped with the issue it was
logged under, and is offered in the Redmine push like time logged on the issue
itself. Relinking never moves time that already exists; `linkWarnings.ts` says
so, with the viewer's own figures, before a link is changed.

**In the table.** A linked issue is shown on the ticket that links to it, not as
a row of its own. That merge lives in `../sources/linkedTickets.ts`.

The GitHub URL is the ticket's older `github` field. It is shown and edited in
the same section as a Redmine link, and the two are mutually exclusive.

## Known follow-ups

- **Server-built sentences are English only.** The lock message and the
  link-change notification (`lockMessage`, `linkNotificationBody` in
  `meteor-backend/server/ticket-link-core.js`) are assembled by concatenation.
  The client's text goes through `ticketLinkStrings.ts`; the server's will need
  the same seam before either can be translated.
- **`SegmentedSwitcher` (`src/ui/`) belongs in `@mieweb/ui`.** It is generic,
  and the library has no segmented control. It should move upstream through the
  `vendor/ui` submodule.
