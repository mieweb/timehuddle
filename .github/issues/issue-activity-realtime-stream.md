# Add Realtime Activity Stream Delivery

## Overview
Issue 14 defines the activity log and feed APIs, but realtime delivery is intentionally deferred. This issue adds a dedicated stream so activity updates can be delivered to connected clients without polling.

## Current State
- Activity events are planned to be stored in `activities` and read via feed pagination.
- Realtime delivery is explicitly deferred from Issue 14.
- Existing product areas already use SSE patterns that can be reused.

## Proposed Changes
1. Implement stream endpoint and connection lifecycle.
- Add `GET /v1/activity/stream` using Server-Sent Events.
- Authenticate and scope each stream to the requesting user or team context.
- Handle keepalive, reconnect guidance, and clean disconnect behavior.
2. Wire datastore updates to stream events.
- Subscribe to activity inserts via MongoDB change streams.
- Translate inserts into stable outbound SSE event payloads.
- Enforce ordering and idempotency semantics for reconnect handling.
3. Add resilience and verification.
- Add backpressure-safe delivery behavior for slow clients.
- Add test coverage for subscription auth, event delivery, and disconnect/reconnect behavior.
- Add operational logging and metrics for stream health.

## Acceptance Criteria
- [ ] `GET /v1/activity/stream` exists and streams activity events over SSE.
- [ ] Stream delivery is correctly scoped and authenticated.
- [ ] New activity inserts are delivered to connected subscribers.
- [ ] Reconnect behavior is documented and validated.
- [ ] Automated tests cover auth, delivery, and connection lifecycle paths.

## Out of Scope (for Now)
- WebSocket transport support.
- Cross-region event replication concerns.
- Push notification fan-out.
- Admin org-wide stream dashboards.
