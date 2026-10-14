---
title: Contribute
summary: The commands, the checks CI runs, and where things live — everything you need for a first pull request.
section: Open source
order: 90
---

TimeHuddle is MIT-licensed and developed in the open at [github.com/mieweb/timehuddle](https://github.com/mieweb/timehuddle). Bugs and ideas go in [issues](https://github.com/mieweb/timehuddle/issues); changes come as pull requests. To get a local copy running first, follow [Run it yourself](/docs/self-hosting).

## Commands

```bash
# Development
npm run dev           # Vite dev server on :3000
npm run dev:mobile    # Vite bound to your LAN, for testing on a device

# Quality gates
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run format        # Prettier check
npm run lint:fix      # auto-fix lint issues
npm run format:fix    # auto-format

# Tests
npm run test:unit     # Vitest unit tests
npm test              # Playwright end-to-end tests
npm run test:all      # unit + e2e — the full gate
```

## Run what CI runs

CI calls the same script you can run locally, so a failure there reproduces here:

```bash
./scripts/checks.sh           # every job
./scripts/checks.sh --fix     # auto-fix lint and format first
```

Pre-commit hooks run lint and format on the files you stage.

## Where things live

| Path              | What it holds                                                     |
| ----------------- | ----------------------------------------------------------------- |
| `src/features/`   | One folder per feature — clock, tickets, huddle, teams, …         |
| `src/ui/`         | The app shell: layout, sidebar, header                            |
| `src/lib/`        | Shared frontend utilities                                         |
| `meteor-backend/` | The Meteor 3 server: methods, collections, publications           |
| `packages/`       | Code shared by frontend and backend, as `@timehuddle/*` packages  |
| `guides/`         | These docs                                                        |
| `release-notes/`  | One note per shipped version, shown in the app and on the website |
| `tests/e2e/`      | Playwright specs                                                  |
| `docs/`           | Design notes and plans for contributors                           |

The frontend and backend never import each other's code; anything both need lives in `packages/`. UI is built from the [`@mieweb/ui`](https://github.com/mieweb/ui) component library.

## A good pull request

- **Small and focused** — the smallest change that fully solves the problem.
- **Checks pass** — `npm run lint`, `npm run typecheck`, `npm run format` and the tests.
- **User-visible?** Add a note in [`release-notes/`](https://github.com/mieweb/timehuddle/tree/main/release-notes) — its README explains the format.
- **Changes what a guide says?** Update the guide in the same pull request. Guides live in [`guides/`](https://github.com/mieweb/timehuddle/tree/main/guides).
