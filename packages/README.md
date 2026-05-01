# packages/

This directory contains shared npm packages consumed by both the frontend and the backend.

Each package lives in its own subdirectory and is scoped as `@timehuddle/<name>` (e.g. `@timehuddle/youtube`).

## Structure

```
packages/
  <name>/
    package.json   # { "name": "@timehuddle/<name>", "version": "0.0.1", ... }
    src/
    index.ts
```

## Adding a New Package

1. Create a new directory under `packages/` (e.g. `packages/my-util/`).
2. Add a `package.json` with `"name": "@timehuddle/my-util"`.
3. Run `npm install` from the repo root to register the new workspace.
4. Import it in the frontend or backend with `import { ... } from '@timehuddle/my-util'`.

## Purpose

Shared utilities, services, and types that belong to neither the frontend nor the backend exclusively should live here to avoid duplication and cross-boundary violations.
