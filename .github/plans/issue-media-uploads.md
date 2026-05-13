## Overview

Improve TimeHuddle media handling by building on what already exists today: Pulse uploads, ticket/clock attachments, and external links.

The codebase already treats attachments as persisted media references (`video`, `image`, `link`) scoped to an entity (`ticket` or `clock`). This issue should focus on tightening and extending that model, not replacing it with a brand-new Media table right now.

## Current State

- We already have authenticated attachment APIs:
	- `POST /v1/attachments`
	- `GET /v1/attachments?kind=...&id=...`
	- `DELETE /v1/attachments/:id`
- Attachments are persisted with: `url`, `type`, optional `title`/`thumbnail`, `attachedTo`, `addedBy`, and `addedAt`.
- Supported attachment types are already `video`, `image`, and `link`.
- Pulse upload flow already exists:
	- Client reserves `videoid` via `POST /v1/pulsevault/reserve`
	- Upload completes through PulseVault TUS routes
	- `onUploadComplete` creates a `video` attachment on the reserved ticket automatically
- Links are already first-class attachments:
	- Manual link add in the Attachments UI
	- YouTube URL detection/title enrichment in both frontend and backend paths
- Pulse page currently builds its media list by aggregating `video` attachments from tickets.

## Proposed Changes

1. Clarify the canonical model in docs and API contracts
- Treat `Attachment` as the source of truth for now (uploaded media and external links).
- Document source semantics without schema churn:
	- Pulse uploads => `type: "video"` + TimeHuddle-hosted URL
	- External links => `type: "link"` (or `video`/`image` when user-selected)

2. Add incremental metadata where it improves UX
- Add optional fields only if used immediately (for example `source`, `mimeType`, `sizeBytes`, `durationMs`).
- Backfill nothing unless required for a user-facing feature.

3. Improve consistency across media entry points
- Ensure AttachmentsPanel, ticket upload flow, and Pulse page all read/write the same attachment shape.
- Standardize title fallback behavior for link/video attachments.

4. Keep Pulse compatibility intact
- Preserve existing Pulse deep-link and compat upload routes.
- Preserve reservation-driven attachment creation on upload complete.

5. Defer a standalone Media library model
- Do not introduce a separate `Media` collection/table in this issue.
- Re-evaluate only when we need cross-entity dedup/reuse, asset lifecycle management, or permissions that cannot be represented by attachments.

## Acceptance Criteria

- [ ] Documentation describes attachments as the current canonical media record.
- [ ] Pulse uploads continue to produce ticket `video` attachments end-to-end.
- [ ] External links remain attachable and retrievable through existing attachment APIs.
- [ ] Any new metadata fields are optional, documented, and used by at least one UI/API path.
- [ ] No regressions in existing ticket/clock attachment flows.

## Out of Scope (For Now)

- Creating a new standalone `Media` persistence model.
- Migrating existing attachment data to a new schema.
- Introducing background transcoding pipelines or a full media CDN workflow.