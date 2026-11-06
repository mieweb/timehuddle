# Deploy Failure Catalog

Every deploy failure we have diagnosed, so the next one is recognised instead of
re-investigated. This file is the memory of the deploy doctor
([`.claude/agents/deploy-doctor.md`](../.claude/agents/deploy-doctor.md)), which
runs automatically when a deploy workflow fails
([`.github/workflows/deploy-doctor.yml`](../.github/workflows/deploy-doctor.yml))
and can be run locally. People add entries too.

## How an entry is written

- **Signature** — the shortest log text that identifies the failure. The doctor
  matches new failures against it, so quote the log, not a paraphrase.
- **Where** — `code` (fixable by a PR), `server` (state on the host: Node,
  `node_modules`, pm2, disk, env), or `infra` (GitHub runner or service
  containers — re-run).
- **Cause**, **Fix**, **Prevention**, and links to the runs and PRs.
- **Seen** — dates, newest first. A recurring entry gets a new date, not a copy.

Newest entries first.

---

## Patch Fails On The Server After A Patch File Changes

- **Signature:** `**ERROR** Failed to apply patch for package @kerebron/<pkg>` in a
  `Deploy …` step, while the `Frontend Checks` job applied the same patch (`✔`).
- **Where:** code (server state left behind by the deploy script)
- **Seen:** 2026-11-05 (5 runs, from
  [42075199557](https://github.com/mieweb/timehuddle/actions/runs/42075199557))
- **Cause:** the deploy ran `npm install` over the server's existing
  `node_modules`. #834 rewrote `patches/@kerebron+extension-menu+0.8.12.patch`
  without changing the package version, so npm kept the copy with the _old_ patch
  applied, and the new patch applied neither forwards nor in reverse (2 of 13
  hunks fail). CI passes because it installs from scratch.
- **Fix:** deploy steps in `main.yml` install with `npm ci`, which removes
  `node_modules` first.
- **Prevention:** never install incrementally on a deploy host. The same drift
  leaves a stale `@mieweb/ui` behind when `vendor/mieweb-ui.tgz` changes.
- **Local repro:** apply the old patch to a clean copy of the package, then
  `patch --dry-run` the new one.

## Typecheck Error In Meteor Backend Tests Blocks Deploy

- **Signature:** `Backend Checks › Typecheck Meteor backend` fails with `error TS…`
  in `meteor-backend/tests/`.
- **Where:** code
- **Seen:** 2026-11-02
  ([41496335804](https://github.com/mieweb/timehuddle/actions/runs/41496335804))
- **Cause:** a merge to `main` brought in a test that does not typecheck
  (`post-attachments-core.test.ts(39,5)`: `unknown[]` not assignable to
  `never[]`). The PR gate runs backend unit tests but not this typecheck, so it
  surfaced only on deploy.
- **Fix:** type the test value; fixed on `main` the same day.
- **Prevention:** run `cd meteor-backend && npx tsc --noEmit` before merging
  backend changes.

## DEV Backend Not Responding After Restart

- **Signature:** `ERROR: DEV backend not responding after 5 attempts` with every
  attempt `HTTP 000`, after `pm2 restart timehuddle-meteor` reported `online`.
- **Where:** server
- **Seen:** 2026-11-02
  ([41491319080](https://github.com/mieweb/timehuddle/actions/runs/41491319080))
- **Cause:** not confirmed. `HTTP 000` means nothing was listening: Meteor
  crashed on start or was still building. The CI log cannot tell which — read
  `sudo pm2 logs timehuddle-meteor --lines 200` on `timecore-dev` next time.
- **Fix:** later deploys succeeded without a code change.
- **Prevention:** none yet.

## Service Container Or Test Backend Fails To Start In CI

- **Signature:** `Failed to initialize container mongo:8`, or
  `Meteor backend at http://localhost:3101 did not become healthy within 30000ms`.
- **Where:** infra
- **Seen:** 2026-11-02
  ([CI / Deploy](https://github.com/mieweb/timehuddle/actions/workflows/ci.yml))
- **Cause:** the GitHub runner could not start the service container, so the
  e2e backend never came up.
- **Fix:** re-run the workflow. Investigate only if it repeats.
