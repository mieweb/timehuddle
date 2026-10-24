# Ticket detail pages

The in-app page for one ticket. Every ticket is a TimeHuddle ticket (#736); a Redmine issue's old address redirects to the ticket carrying it. `src/ui/AppLayout.tsx` renders the matching page.

| File                        | Role                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TicketDetailPage.tsx`      | A Huddle ticket (`/app/tickets/:id`). Everything is editable, with attachments and delete.                                                                                                                 |
| `RedmineIssueRedirect.tsx`  | `/app/tickets/redmine/:id`: finds or creates the issue's ticket in the selected team (`../carryIssue.ts`) and replaces the URL with its page.                                                              |
| `BackToTicketsButton.tsx`   | The "← TICKETS" pill both pages share.                                                                                                                                                                     |
| `TicketAttachmentsCard.tsx` | The Attachments card both pages share: links plus a Pulse video. Stored in TimeHuddle's `attachments` collection under kind `ticket`; nothing is uploaded to Redmine.                                      |
| `TicketActivityCard.tsx`    | The Activity card both pages share. It sizes to its content, is capped at the viewport height, and scrolls inside.                                                                                         |
| `activityEntries.ts`        | Pure builders that turn each kind of history into one timeline: Huddle activity events, the viewer's own timer sessions, and Redmine journals and time entries. Each entry says whether the viewer did it. |

**Redmine time entries are everyone's, the newest 10**, minus the ones TimeHuddle pushed for the viewer (matched by id in `redmine_time_syncs`): that time already shows as the viewer's own sessions.

**Time sessions are the viewer's own.** `timers.getTicketSessions` is scoped to the caller, like `timers.getTicketTotal`, so nobody sees another person's sessions here.
