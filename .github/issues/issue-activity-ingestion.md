# Add External Activity Ingest Endpoint

## Overview
Issue 14 introduces the internal activity log foundation. External event producers still need a dedicated ingestion path so integrations can publish normalized events without coupling to internal user-session auth.

## Current State
- The activity log issue defines a unified event model and feed surface.
- External ingest is explicitly deferred from Issue 14.
- There is no API-key based ingest endpoint for third-party or service-originated activity events.

## Proposed Changes
1. Define the ingest contract and auth model.
- Add `POST /v1/activity/ingest` with API-key authentication.
- Accept normalized activity events that map to the shared activity schema.
- Validate payload shape per event type at write time.
2. Implement ingestion service path.
- Add backend route, controller, and service wiring for ingest requests.
- Persist accepted events into `activities` with correct `source` attribution.
- Return clear error responses for invalid auth and invalid payloads.
3. Add observability and guardrails.
- Add structured logs for accepted and rejected ingest attempts.
- Add basic rate limiting or throttling for API-key traffic.
- Add tests for auth, validation, and successful persistence.

## Acceptance Criteria
- [ ] `POST /v1/activity/ingest` exists and is API-key authenticated.
- [ ] Valid external events are persisted to `activities` with `source` metadata.
- [ ] Invalid payloads and invalid keys return deterministic error responses.
- [ ] Automated tests cover happy path and key failure cases.
- [ ] API contract is documented for external producers.

## Out of Scope (for Now)
- Realtime fan-out of ingested events to clients.
- Provider-specific adapters or SDKs.
- Advanced per-provider routing rules.
- Bulk backfill tooling for historical imports.
