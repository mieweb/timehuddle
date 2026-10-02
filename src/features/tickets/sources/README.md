# Ticket sources

Everything the unified ticket list at `/app/tickets` can draw from.

Tickets come from more than one system — TimeHuddle's own `Ticket` collection and
a connected Redmine instance today. Rather than give each one its own page, every
source is normalized to a single `UnifiedTicket` shape here, so the list, filter
bar, and row component never learn where a ticket came from.

## Files

| File                   | Role                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `types.ts`             | The `UnifiedTicket` shape and the `TicketSource` contract                     |
| `registry.ts`          | `TICKET_SOURCES` — the list of active sources. **The anchor of this folder.** |
| `huddleSource.ts`      | Adapter over `ticketApi` (team-scoped, full CRUD)                             |
| `redmineSource.ts`     | Adapter over `redmineApi` (user-scoped via personal API key, read-only)       |
| `useUnifiedTickets.ts` | Loads every source and merges the results                                     |
| `index.ts`             | Public surface — import from here, not from an adapter                        |

## Adding a source

1. Widen `TicketSourceId` in `types.ts`.
2. Write `mySource.ts` exporting a `TicketSource<Raw>`:
   - `capabilities` — what the user may do from a row. Every mutating control in
     the UI is gated on these, so a read-only source cannot render an action it
     cannot perform.
   - `isAvailable(ctx)` — return `false` when the source cannot be used at all
     (e.g. no account linked). An unavailable source is omitted **silently**; it
     is not an error the user has to dismiss.
   - `fetch(ctx)` — return raw items.
   - `toUnified(raw, ctx)` — map one raw item to a `UnifiedTicket`. Keep it pure
     so it is directly unit-testable.
3. Add `defineSource(mySource)` to `TICKET_SOURCES` in `registry.ts`.
4. Add a `mySource.test.ts` next to it.

Nothing else changes. The source filter, badges, sorting, and the row all pick
the new source up from the registry.

## Rules

- **Normalize at read time, never persist.** No source information is written to
  the core `Ticket` model. The `key` field (`` `${sourceId}:${id}` ``) is row
  identity for React and nothing more.
- **Ids are namespaced per source.** A Huddle user id and a Redmine user id are
  different things that may collide. Never compare or merge them across sources.
- **`status.native` is what the row shows; `status.isClosed` is what we filter
  on.** It is the only cross-source status fact we derive, and it drives the
  Open/Closed tabs. Redmine statuses are instance-defined free text, so the name
  alone cannot tell you whether an issue is closed — use the source's own flag.
- **Mutation methods on `TicketSource` are optional and still unimplemented.**
  They exist so write support can be added without redesigning the interface.
  Redmine gained create/edit in Milestone 6 without them: its dialogs live in
  `../redmine/` and call `redmineApi` directly, exactly as Huddle's modals call
  `ticketApi`. Reach for this seam only when a third source needs the same
  writes. Issues are never persisted — Redmine reads stay live.
- **The Redmine list is cached for the session**, keyed by user and scope, so
  remounts do not refetch. Anything that changes what Redmine would return has to
  call `invalidateRedmineCache()`. Linking or unlinking an account in Settings is
  one such thing, and it reaches this page through the `redmine:changed` event
  (`lib/useRedmineStatus.ts`) — `TicketsPage` stays mounted behind every route, so
  without that signal it would serve the cached list until the window reloaded.
