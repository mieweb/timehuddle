# Mongoose Schema Migration Planning Document

## Overview

This document outlines a recommended strategy for handling schema migrations in a Node.js application using MongoDB and Mongoose.

Unlike traditional SQL ORMs, Mongoose does not provide built-in automatic schema migrations. MongoDB is schema-flexible, which means documents may exist in multiple schema versions simultaneously. Because of this, applications using Mongoose should adopt a deliberate migration strategy to ensure long-term maintainability and data consistency.

---

# Goals

* Establish a safe and maintainable schema evolution process
* Avoid breaking changes when schemas change
* Support both lightweight and production-grade migration workflows
* Ensure backward compatibility where possible
* Create a scalable migration architecture for future growth

---

# Current Limitation

Mongoose does **not** automatically migrate existing MongoDB documents when schemas change.

For example:

## Initial Schema

```js
const UserSchema = new mongoose.Schema({
  name: String
});
```

## Updated Schema

```js
const UserSchema = new mongoose.Schema({
  name: String,
  age: Number
});
```

Existing documents in MongoDB remain unchanged:

```json
{
  "name": "Mike"
}
```

Mongoose will not:

* backfill missing fields
* rewrite documents automatically
* apply database migrations

The new field only exists for:

* newly created documents
* documents explicitly updated and saved

---

# Recommended Migration Strategy

The recommended approach combines:

1. Schema defaults
2. Backward-compatible schema design
3. Versioned migration scripts
4. Optional document schema versioning

---

# Phase 1 — Use Schema Defaults

For simple schema additions, defaults are often sufficient.

## Example

```js
const UserSchema = new mongoose.Schema({
  name: String,
  age: {
    type: Number,
    default: 0
  }
});
```

Benefits:

* Existing documents continue functioning
* Missing fields resolve safely in application code
* No immediate database migration required

Recommended for:

* optional fields
* non-critical fields
* incremental feature additions

---

# Phase 2 — Introduce Explicit Migrations

As the application grows, manual migration scripts should be introduced.

## Recommended Tool

### migrate-mongo

This is one of the most widely used MongoDB migration frameworks for Node.js applications.

## Installation

```bash
npm install migrate-mongo
```

---

# Migration Workflow

## Create a Migration

```bash
npx migrate-mongo create add-age-field
```

## Example Migration

```js
module.exports = {
  async up(db) {
    await db.collection('users').updateMany(
      { age: { $exists: false } },
      { $set: { age: 0 } }
    );
  },

  async down(db) {
    await db.collection('users').updateMany(
      {},
      { $unset: { age: "" } }
    );
  }
};
```

## Run Migrations

```bash
npx migrate-mongo up
```

---

# Recommended Project Structure

```text
project-root/
├── migrations/
├── models/
├── services/
├── scripts/
├── src/
└── package.json
```

---

# Deployment Integration

Migrations should run during deployment before the application starts serving traffic.

## Recommended Deployment Order

1. Deploy new code
2. Run migrations
3. Start/restart application
4. Monitor logs and database health

---

# Backward Compatibility Guidelines

MongoDB applications should tolerate documents existing in multiple versions temporarily.

Recommended practices:

## Prefer Optional Fields

```js
email: {
  type: String,
  required: false
}
```

## Avoid Breaking Renames

Instead of immediately renaming:

```js
fullName
```

to:

```js
displayName
```

Prefer a staged rollout:

1. Add new field
2. Populate new field
3. Update application usage
4. Remove old field later

---

# Schema Versioning Strategy

For larger applications, document-level schema versioning is recommended.

## Example

```js
const UserSchema = new mongoose.Schema({
  schemaVersion: {
    type: Number,
    default: 2
  }
});
```

Benefits:

* Enables lazy migrations
* Allows rolling upgrades
* Simplifies long-term compatibility

---

# Lazy Migration Pattern

Documents can be upgraded during read operations.

## Example

```js
async function upgradeUser(user) {
  if (!user.schemaVersion || user.schemaVersion < 2) {
    user.age = 0;
    user.schemaVersion = 2;

    await user.save();
  }

  return user;
}
```

Recommended for:

* large collections
* high-availability systems
* applications where full migrations are expensive

---

# Production Best Practices

## Always Backup Before Migrations

Especially before:

* destructive updates
* field removals
* data transformations

---

## Write Idempotent Migrations

Migrations should be safe to run multiple times.

Good example:

```js
{ age: { $exists: false } }
```

Bad example:

```js
{ $set: { age: 0 } }
```

without filtering.

---

## Avoid Blocking Operations

Large `updateMany()` operations may:

* lock resources
* increase load
* impact performance

For large datasets:

* batch updates
* use queues
* migrate incrementally

---

## Keep Migrations in Source Control

Migration files should:

* live alongside application code
* be versioned in Git
* deploy consistently across environments

---

# Recommended Architecture

## Small Applications

Use:

* schema defaults
* optional fields
* occasional manual scripts

Avoid:

* unnecessary migration complexity

---

## Medium to Large Applications

Use:

* `migrate-mongo`
* versioned migrations
* schema versioning
* backward compatibility policies

---

# Risks and Considerations

| Risk                                   | Mitigation                         |
| -------------------------------------- | ---------------------------------- |
| Old documents missing fields           | Use defaults and optional fields   |
| Breaking schema changes                | Use staged rollouts                |
| Large migrations impacting performance | Batch or lazy migrate              |
| Data inconsistency                     | Use schema versions and validation |
| Deployment failures                    | Run migrations before app startup  |

---

# Recommended Initial Action Plan

## Immediate

* Add defaults to new schema fields
* Make new fields backward compatible
* Create `/migrations` directory

## Short-Term

* Install and configure `migrate-mongo`
* Add migration execution to deployment pipeline
* Create migration naming conventions

## Long-Term

* Introduce document schema versioning
* Build internal migration guidelines
* Standardize migration testing procedures

---

# Final Recommendation

For this application, the recommended long-term approach is:

## Use Mongoose for:

* schema validation
* models
* middleware
* application-level structure

## Use migrate-mongo for:

* database migrations
* schema evolution
* deployment-safe updates

## Use defaults and backward compatibility for:

* lightweight schema changes
* gradual upgrades
* operational stability

This approach provides a scalable, production-friendly foundation while remaining aligned with MongoDB’s flexible document model.
