# Data Integrity with Mongoose and Migrations

> **STATUS: READY** — Ready for implementation.

## Current State

TimeHuddle does **not** currently use Mongoose.

The backend uses:

- the MongoDB Node driver directly
- collection helpers and service-layer validation
- a small custom migration runner in `backend/scripts/migrate.ts`
- numbered migration files in `backend/scripts/migrations/`
- a `_migrations` collection to record which migrations have run

That current setup is simple and functional. It already supports forward-only, idempotent migrations such as:

- normalizing clock event timestamps
- creating indexes needed by application queries
- removing legacy timer fields after the work-item refactor

The existing system works, but it has clear limits:

- schema expectations live mostly in TypeScript types and service code
- document validation is distributed rather than centralized in model definitions
- migration registration is manual in a single script
- there is no standard pattern for richer schema-level validation, middleware, or model lifecycle hooks

---

## Why Consider Mongoose

Mongoose would not replace MongoDB itself or automatically solve migrations, but it would give TimeHuddle a more explicit application-layer model system.

Potential benefits for this codebase:

- centralized schema definitions for core collections
- defaults, validation, and casting in one place
- clearer model-level invariants for documents like users, teams, tickets, clock events, work items, and timer sessions
- a consistent place for indexes that are part of the model definition
- easier mental mapping between domain entities and persistence rules

This is most valuable if TimeHuddle expects the data model to keep growing in complexity.

Mongoose should be treated as an application modeling layer, not as a migration tool.

---

## Why Consider `migrate-mongo`

TimeHuddle already has a homegrown migration runner. It is adequate today, but `migrate-mongo` would add a more standardized migration workflow.

Potential benefits:

- conventional migration file generation and ordering
- built-in migration state tracking
- a more familiar developer workflow for MongoDB schema/data changes
- less manual bookkeeping than updating one central migration runner file
- easier long-term scaling as the number of migrations grows

This would not replace Mongoose. These solve different problems:

- **Mongoose**: schema modeling, validation, defaults, and model APIs
- **`migrate-mongo`**: ordered database migrations and migration bookkeeping

---

## The Core Problem

MongoDB allows multiple document shapes to coexist. That flexibility is useful, but it creates risk when code assumes one canonical shape while stored data still reflects older versions.

For TimeHuddle, the real data-integrity problems are:

- old documents can silently remain in outdated shapes
- cleanup work can be skipped when feature work moves quickly
- invariants are easy to scatter across services instead of enforcing them consistently
- indexes that matter to correctness or scale can become implicit rather than deliberate

Introducing Mongoose and a more standard migration tool would be a way to tighten discipline around those problems, not an end in itself.

---

## Recommended Direction

If TimeHuddle wants to strengthen data integrity, the recommended target architecture is:

- use **Mongoose** for model definitions, schema validation, defaults, and model-level indexes
- use **`migrate-mongo`** for forward-only database migrations
- keep business rules in services where they involve cross-document workflows
- phase out the custom migration runner only after the replacement path is proven

This should be an incremental migration, not a big-bang rewrite.

---

## Proposed Architecture

### Persistence Layer

Use Mongoose schemas and models for the collections that carry the most business complexity, such as:

- users
- teams
- tickets
- clock events
- work items / time entries
- timer sessions
- notifications or other high-value domain records

Each schema should define:

- required and optional fields
- enums and defaults
- indexes that are part of the model contract
- timestamp behavior where appropriate

### Migration Layer

Use `migrate-mongo` for explicit database changes such as:

- backfilling newly required fields
- renaming fields
- converting data types
- creating or dropping indexes
- removing obsolete fields after a model transition

Schema definitions should not be relied on to mutate existing documents. That remains migration work.

---

## What We Have Today vs. What This Plan Adds

### Today

- raw MongoDB driver access
- hand-written collection access patterns
- custom migration runner with ordered imports
- `_migrations` collection already in place
- good enough for current scale, but largely convention-driven

### With Mongoose + `migrate-mongo`

- explicit schemas for document shape and validation
- a standard model layer instead of ad hoc collection helpers
- a standard migration CLI and file structure
- less manual coordination when creating future migrations
- clearer separation between runtime validation and persisted-data transformation

---

## Phased Adoption Plan

### Phase 1: Document and Stabilize the Current System

Before adding any new dependency, make the current approach explicit.

Actions:

1. Document the current migration contract in the backend README or ops notes.
2. Confirm that all existing migrations are idempotent.
3. Define what belongs in service validation versus migration logic.
4. Treat `_migrations` as the current source of truth until a replacement is active.

Outcome:

The current system becomes deliberate rather than accidental.

### Phase 2: Introduce `migrate-mongo`

Adopt a standard migration tool first, before introducing Mongoose models.

Actions:

1. Add `migrate-mongo` to the backend.
2. Create a migration configuration scoped to the backend environment.
3. Decide whether the existing `_migrations` collection should be reused or whether a new migration-state collection is acceptable.
4. Port the current custom migrations into the new format, or freeze old migrations in place and use `migrate-mongo` only for new ones.
5. Add scripts for creating and running migrations.

Likely scripts:

```bash
npm run migrate:create -- add-work-item-index
npm run migrate:up
npm run migrate:down
```

Outcome:

Migration workflow becomes standardized without changing the domain model layer yet.

### Phase 3: Introduce Mongoose Gradually

Add Mongoose one collection at a time rather than replacing all persistence code at once.

Suggested order:

1. start with a lower-risk collection that has obvious schema value
2. validate that connection management and model loading work cleanly with the current backend
3. move higher-complexity collections only after the first model proves the pattern

Practical candidates depend on the desired payoff, but tickets, clock events, and timer-related collections are likely strong contenders because they carry more business rules.

Outcome:

TimeHuddle gains model-level validation without forcing an all-at-once persistence rewrite.

### Phase 4: Consolidate

Once enough of the backend has moved over:

1. retire redundant collection helpers
2. remove the custom migration runner if `migrate-mongo` fully replaces it
3. standardize backend write paths around model and service boundaries
4. document the final conventions clearly

Outcome:

The backend ends up with a coherent model and migration story instead of two half-systems living forever.

---

## Setup Outline

### Mongoose Setup

At a high level, setup would require:

1. install `mongoose` in `backend/`
2. add a shared connection module
3. create model files for chosen collections
4. define schema validation and indexes in those model files
5. update selected services to use models instead of raw collection helpers

Important constraint:

This should not blur the frontend/backend boundary or introduce duplicate model definitions across layers. Persistence models remain backend-only.

### `migrate-mongo` Setup

At a high level, setup would require:

1. install `migrate-mongo` in `backend/`
2. create its config file with the correct MongoDB URI handling
3. choose a migration directory
4. wire package scripts for create/apply/status operations
5. decide how to transition from the current custom runner

The key design decision is transition strategy, not package installation.

---

## Transition Options for Existing Migrations

There are two realistic ways to handle the current homegrown migration system.

### Option A: Freeze Old Migrations, Use `migrate-mongo` for New Ones

Pros:

- lowest-risk transition
- no need to rewrite already-applied migration history
- fast adoption path

Cons:

- two migration systems exist temporarily
- conventions must be clearly documented to avoid confusion

### Option B: Port Existing Migrations into `migrate-mongo`

Pros:

- cleaner long-term migration story
- one tool and one workflow

Cons:

- more setup work now
- higher risk of migration bookkeeping mistakes

Recommended default:

Start with **Option A**, then collapse to one system later if the tooling proves worthwhile.

---

## Data Integrity Principles Regardless of Tooling

Even after adding Mongoose and `migrate-mongo`, the core rules should stay the same.

### Canonical data should exist in one place

Do not store the same business truth in multiple places unless there is a deliberate projection strategy.

### Runtime validation and migration work are different concerns

Mongoose can validate new writes. It does not automatically rewrite old records. Existing persisted data changes still require migrations.

### Cross-document invariants still belong in services

Rules like "only one active timer session per user" are larger than a single document schema and should continue to live in service logic plus indexes where needed.

### Indexes are part of integrity

Indexes that support uniqueness or correctness should be treated as part of the model contract and migration plan, not as optional optimizations.

---

## Risks

- introducing Mongoose can create churn if applied across the whole backend too quickly
- dual-running the old and new migration systems can confuse developers if undocumented
- model hooks and abstraction layers can overcomplicate a codebase that is currently straightforward
- schema strictness can surface existing data-quality issues that were previously hidden

These are manageable risks if adoption is incremental.

---

## Recommendation

TimeHuddle should not jump straight from the current raw-driver setup to a full Mongoose rewrite.

The better plan is:

1. acknowledge and document the current custom migration system
2. introduce `migrate-mongo` first to standardize migration workflow
3. introduce Mongoose selectively where schema-level validation adds real value
4. keep service-layer business rules for multi-document behavior
5. remove the old migration runner only when the replacement path is proven

That gives TimeHuddle a realistic upgrade path: stronger data integrity, more standardized migrations, and no need for a risky all-at-once backend rewrite.