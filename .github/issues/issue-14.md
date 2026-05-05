As TimeHuddle gains more features (clock in/out, tickets, video uploads, ActivityWatch integration, etc.), each produces user-visible events with no shared home. Rather than building per-feature feeds, we should establish a single **activity log** that all sources write to — a pattern used by GitHub, Linear, Jira, and most enterprise SaaS products.

## Why now

Establishing this before clock, tickets, and integrations grow further means each feature hooks in with one line rather than a retro-fit. Adding a new source later = one `emitActivity()` call, zero schema migration.

## Core concept

A single `activities` MongoDB collection with a normalized, typed schema:

```ts
interface ActivityEvent {
  _id: ObjectId;
  userId: string;
  type: string;          // e.g. "clock.in" | "ticket.created" | "video.uploaded"
  actor: { id: string; name: string; avatar?: string };
  payload: Record<string, unknown>;  // type-specific, validated at write time
  occurredAt: Date;
  source: "timehuddle" | "activitywatch" | "external";
}
```

Type safety is enforced via a TypeScript discriminated union at the write layer — the DB stays schemaless, but nothing writes an unknown shape.

## Emitter layer (internal sources)

A single `emitActivity()` function all internal features call after their existing side effects:

```ts
await emitActivity({ userId, teamId, type: "clock.in", payload: { timestamp } });
```

No feature needs to know about the feed — they just fire and forget.

## Feed API

```
GET /v1/activity/feed?userId=&limit=50&before=<cursor>
```

Cursor-based pagination over `{ occurredAt: -1 }`. Scoped by user or team.

## Real-time

MongoDB change stream on the `activities` collection → SSE channel `GET /v1/activity/stream`, consistent with existing SSE patterns in the codebase (messages, notifications, clock).

## Out of scope

- External ingestion.
- Per-event privacy controls / visibility rules
- Email digest or push notification fan-out from events
- Admin-level org-wide activity log
- Replay / event sourcing (append-only log is sufficient for a feed)
