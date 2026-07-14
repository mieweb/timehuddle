# Fastify Dead-Code Cleanup Inventory

**Status:** For review — nothing deleted or edited yet.
**Context:** The Fastify + Better Auth backend was removed in commit `401bad5` (the entire old `backend/` app). `meteor-backend/` (Meteor 3 + `meteor-wormhole`) is now the only live backend. Everything below is Fastify **residue** — leftover files, one-time migration scripts, stale config, dead frontend fallbacks, and outdated instructions.

Categories are ordered from **safe to delete** → **needs a decision**. Each item notes a recommended action.

---

## A. Dead files — safe to delete

| File | Why it's dead | Action |
| ---- | ------------- | ------ |
| `meteor-backend/server/main.js.bak` | Backup snapshot of `main.js`, tracked in git. Only reason it exists is a manual save during migration. | **Delete** |
| `meteor-backend/server/pulsevault.js.bak` | Backup of the (Fastify-ported) PulseVault module. The live `pulsevault.js` supersedes it. | **Delete** |
| `backend/` (whole directory) | Fastify app already removed. Only leftover is `backend/migrations/20260627_120000_add-user-blocked-field.cjs`, a one-off migration that has already been applied. The empty shell is a "junk drawer" (violates the Folder Philosophy in the instructions). | **Delete dir** (or move the one migration to `.attic/` if you want a record) |

---

## B. One-time migration scripts — completed, now dead

These exist only to move users off the Fastify/Better-Auth `user` collection onto Meteor Accounts (`users`). The migration is done. Per the repo's Dead-Code policy, move to `.attic/` (with a note) rather than deleting outright, since they document how the migration was performed.

**In `meteor-backend/scripts/`:**
- `remigrate-users.js` — reads the Fastify `user` collection
- `verify-migration.js` — cross-references Fastify → Meteor users
- `drop-legacy-collections.js` — drops the old `user`/session/account collections
- `README.md` — documents the above (Better Auth → Meteor Accounts migration)

**In root `scripts/`:**
- `migrate-to-meteor-accounts.js`
- `migrate-all-collections.js`
- `migrate-all-data.mjs`
- `migrate-complete.mjs`
- `verify-user-collections.js`
- `fix-org-members.js`
- `prune-legacy.sh`

**Root-level driver files:**
- `run-migration.sh`
- `.migration-automation.md`

**`package.json` scripts to remove** (they point at the above):
- `"migrate": "node scripts/migrate-complete.mjs"`
- `"migrate:dry-run": "node scripts/migrate-complete.mjs --dry-run"`
- `"prune:legacy": "bash ./scripts/prune-legacy.sh --yes"`

> ⚠️ **Confirm the production migration is fully complete before removing these.** `docs/meteor-audit.md` still lists "Drain the legacy password fallback" and "Retire old Fastify code paths" as *in progress*. If any environment still needs to run these, keep them until cutover.

---

## C. Stale config referencing Fastify — update, don't delete

| File | Fastify reference | Action |
| ---- | ----------------- | ------ |
| `docker-compose.yml` | `FASTIFY_AGENDA_ENABLED=false`, `AUTH_FASTIFY_URL=http://backend:4000`, and comments about a `backend` service on :4000 | Remove the dead `backend` service + env vars; drop the coexistence comments |
| `scripts/checks.sh` | `FASTIFY_URL="${FASTIFY_URL:-http://localhost:4000}"` + "requires Meteor + Fastify" note | Remove Fastify URL/env; point checks at Meteor only |
| `.github/workflows/checks.yml` | Job disabled with `if: false # Fastify backend removed` | Remove the dead job entirely instead of leaving it disabled |
| `.github/workflows/pr-preview.yml` | Comment "Backend: Fastify server on 0.0.0.0:4000" | Update comment/step to Meteor backend |
| `ecosystem.config.cjs` | Comment only: `// Point to Meteor (Fastify removed)` | Trim stale comment (low priority) |
| `scripts/dev-ios.sh` | Comment: "Fastify backend disabled — using Meteor" | Trim stale comment (low priority) |

---

## D. Frontend dead/stale Fastify code — verify then remove

The frontend still carries Better-Auth/Fastify JWT fallbacks. Since the Fastify backend is gone, these branches are almost certainly dead, but they touch auth so **verify before ripping out.**

| File | What's there | Action |
| ---- | ------------ | ------ |
| `src/lib/api.ts` (~L148–170+) | `getAccessToken()` still tries a "cached JWT (Fastify sessions)" and a "Fastify JWT" fetch to `/api/auth/token` via `sessionToken`. Meteor resume token is the real path. | Confirm `sessionToken` is never set anymore, then remove the Fastify JWT branch + `cachedJwt`/`jwtFetch` plumbing |
| `src/ui/GitHubConnectionRow.tsx` (~L36) | "Skip if no Fastify session — Meteor users don't have linked Better Auth accounts" | Verify whether Better-Auth linking is still reachable; likely remove the skip |
| `src/features/tickets/TicketsPage.tsx` (~L565) | Comment referencing "Fastify REST" writers | Comment-only — update wording |
| `src/features/timers/WorkPage.tsx` (~L288) | Comment referencing "Fastify REST mutations" | Comment-only — update wording |
| `src/features/notifications/ShiftReminderContext.tsx` (~L198) | Comment "Fastify returned 404…" | Comment-only — update wording |
| `src/lib/ddp.ts` (~L12) | Comment "any write from the Fastify backend…" | Comment-only — update wording |
| `src/lib/TeamContext.tsx` (~L370) | Comment "any writer (Fastify REST, Meteor methods…)" | Comment-only — update wording |

---

## E. Documentation referencing Fastify

| File | Issue | Action |
| ---- | ----- | ------ |
| `README.md` (L3, L105) | Describes the app as "powered by a Fastify + MongoDB backend" and `npm run dev # Fastify API on :4000`. **Actively misleading** — the backend is Meteor. | **Fix** — describe Meteor backend |
| `database.md` (L26, L130) | Diagram shows "Fastify /v1/* Routes"; "all `/api/auth/*` routes … proxied through Fastify" | **Fix** to reflect Meteor/wormhole + better-auth-for-SSO-only |
| `public/launch-deck.html`, `ios/App/App/public/launch-deck.html`, `android/app/src/main/assets/public/launch-deck.html` (all L980) | "Fastify v5" tech-stack slide (3 copies of same deck) | Update slide to Meteor (or drop) — remember all 3 copies |
| `meteor-to-production-plan.md` | Historical migration tracker — Fastify refs are intentional history | **Keep** (it's the record of the migration) |
| `docs/meteor-audit.md` | Progress/status doc — Fastify refs describe remaining work | **Keep** (update as items close) |
| `meteor-backend/*.js` inline comments (agenda, notify-core, tickets, collections, push, auth-bridge, timer-core, huddle, email, notifications) | Many "…the Fastify backend used to…/during Fastify coexistence…" comments | **Low priority** — accurate as history; refresh opportunistically once coexistence truly ends |

---

## F. Copilot instructions — `.github/copilot-instructions.md` (== `CLAUDE.md` symlink)  ⭐ most important

The instructions still describe a **Fastify backend that no longer exists**. This actively misleads any AI/dev working in the repo. Proposed edits:

1. **Line 5** — "The backend is a separate **Fastify + MongoDB** service located in `backend/`."
   → Replace with: the backend is a **Meteor 3** app in `meteor-backend/`, exposing Meteor methods as REST/OpenAPI/MCP via `meteor-wormhole`.

2. **"Backend Architecture: Route → Controller → Service" section** — describes Fastify routes/controllers/services in `backend/src/…`, "Fastify schema", "`preHandler`/`onRequest` hooks", "Services never import Fastify types". **This entire architecture is gone.**
   → Replace with the Meteor model: methods + publications in `meteor-backend/server/`, `meteor-wormhole` for REST exposure, `permissions.js` for authz.

3. **Mongoose-specific subsections** (ESM import rule, `_id` pinning, pre-hook signature, `ensureMongooseConnected`) — these were Fastify-backend conventions. Meteor uses its own Mongo collections (`collections.js`).
   → Verify what still applies under Meteor; trim/rewrite the parts that don't.

4. **Troubleshooting** — "ensure the backend is running on port 4000" → Meteor runs on **:3100** (`meteor run --port 3100`, per `meteor-backend/package.json`).

> Recommend doing section F as a focused follow-up edit once you've confirmed the Meteor architecture wording you want, since it's the highest-impact and most opinionated change.

---

## Suggested execution order

1. **A** — delete `.bak` files + empty `backend/` shell (zero risk).
2. **F** — fix the copilot instructions (highest value, no runtime risk).
3. **E** — fix `README.md` + `database.md` (they mislead newcomers).
4. **C** — clean stale config/env/CI.
5. **D** — verify then remove dead frontend auth fallbacks.
6. **B** — move migration scripts to `.attic/` **only after confirming prod cutover is complete.**
