# Migration Plan: Meteor → Timecore

## Rationale

Meteor's tightly-coupled DDP protocol and proprietary accounts system lock timehuddle to a single Node.js monolith that cannot be shared with mobile clients or scaled independently. Replacing it with timecore (a standard REST/SSE API) makes the auth and data layer portable across web, iOS, and Android while removing a framework dependency that adds ~40 MB to the bundle and limits hiring to Meteor specialists.

## Summary

Migrate timehuddle off Meteor entirely. Replace Meteor DDP, accounts, and collections with
the shared timecore backend (Fastify + better-auth + MongoDB). The result is a Meteor-free
React app that shares a universal codebase with future mobile (Capacitor / Expo / React Native).

## Background

**timecore** (`localhost:4000` in dev) is a Fastify + MongoDB service using better-auth for
email/password authentication. It already has `/v1/me` and `/v1/me/profile`
stubbed. Everything else needs to be added there as part of this migration.

**timehuddle** currently uses:
- `meteor/accounts-base` for auth
- Meteor DDP (WebSockets) for 13 real-time publications
- `useTracker` / `useSubscribe` as the reactive data layer
- Meteor methods (35 total) as the mutation layer

## Real-Time Replacement Strategy

Meteor publications become one of two things in timecore:

| Publication | Real-time need | Replace with |
|---|---|---|
| `userTeams`, `teamDetails`, `teamMembers` | Low | REST + refresh on action |
| `teamTickets` | Medium | REST + poll (5 s) or SSE |
| `clockEventsForTeams` | **High** — live dashboard | **SSE** `/v1/clock/live` |
| `messages.thread` | **High** — chat | **SSE** per thread |
| `notifications.inbox` | Medium | SSE or REST + poll |
| `clockEventsForUser` | Medium | REST + refresh on action |

SSE (Server-Sent Events) is Fastify-native, works in browsers and React Native via `EventSource`,
and requires zero extra libraries.

`useTracker` + `useSubscribe` are replaced by **TanStack Query (React Query)** which handles
caching, background refetch, optimistic updates, and SSE — and runs identically in React,
React Native, and Expo.

---

## Phase 1 — Authentication

**Effort:** 1–2 days  
**Goal:** Replace `meteor/accounts-base` with better-auth. After this phase Meteor is only used
for data — auth is fully owned by timecore.

### timehuddle changes
- [x] Replace `LoginForm.tsx` to call `POST /api/auth/sign-in` and `POST /api/auth/sign-up`
- [x] Add "Forgot password?" flow: submits email to `POST /api/auth/request-password-reset`
- [x] Add reset-password landing: reads `?token=` from URL, submits new password to `POST /api/auth/reset-password`
- [x] Replace `Meteor.user()` + `useTracker` with a `useSession()` hook (`GET /v1/me`)
- [x] Replace `Meteor.logout()` with `POST /api/auth/sign-out`
- [x] Remove `imports/features/auth/api.ts`
- [x] Remove `imports/startup/server.ts` (Accounts.config, email hook)
- [x] Update `client/main.tsx` — gate on `useSession()` instead of `Meteor.user()`

### timecore changes
- [x] Configure `sendResetPassword` email callback in `emailAndPassword` auth config — better-auth handles `POST /api/auth/request-password-reset` and `POST /api/auth/reset-password` automatically
---

## Phase 2 — Profile & User Lookups

**Effort:** 1 day  
**Goal:** Remove `Meteor.users` and the `userProfiles` Mongo collection; all user data lives in
timecore's `users` collection managed by better-auth.

### timehuddle changes
- [x] Replace `profile.update` Meteor method call → `PUT /v1/me/profile`
- [x] Replace `Meteor.users` lookups (display names, avatars) → REST calls
- [x] Remove `imports/features/profile/api.ts` server half
- [x] Remove `imports/lib/userDisplayName.ts` Meteor dependency

### timecore changes
- [x] `GET /v1/users/:id` — single user lookup
- [x] `GET /v1/users?ids=id1,id2,...` — batch lookup (capped at 200)
- [x] `PUT /v1/me/profile` — already stubbed, implement write

---

## Phase 3 — Teams

**Effort:** 2–3 days  
**Goal:** Move all team management to timecore REST.

### timehuddle changes
- [x] Replace all 10 team Meteor methods with REST calls
- [x] Replace `userTeams` / `teamMembers` publications with REST + stale-while-revalidate
- [x] Remove `imports/features/teams/api.ts` server half

### timecore changes
- [x] `GET /v1/teams` — teams for current user
- [x] `POST /v1/teams` — create team
- [x] `DELETE /v1/teams/:id` — delete team
- [x] `PUT /v1/teams/:id/name` — rename
- [x] `GET /v1/teams/:id/members` — member list with user details
- [x] `POST /v1/teams/:id/invite` — invite by email
- [x] `POST /v1/teams/:id/join` — join by code
- [x] `DELETE /v1/teams/:id/members/:userId` — remove member
- [x] `PUT /v1/teams/:id/members/:userId/role` — promote/demote admin
- [x] `PUT /v1/teams/:id/members/:userId/password` — admin set member password

---

## Phase 4 — Tickets

**Effort:** 2 days  
**Goal:** Move ticket CRUD and timer operations to timecore.

### timehuddle changes
- [x] Replace 6 ticket Meteor methods with REST calls
- [x] Replace `teamTickets` / `adminTeamTickets` publications with REST + poll or SSE
- [x] Remove `imports/features/tickets/api.ts` server half
- [ ] Admin ticket review page — team-admin view of all tickets across managed teams, with batch status update

### timecore changes
- [x] `GET /v1/tickets?teamId=` — list tickets for team
- [x] `POST /v1/tickets` — create ticket
- [x] `PUT /v1/tickets/:id` — update ticket
- [x] `DELETE /v1/tickets/:id` — delete ticket
- [x] `POST /v1/tickets/:id/start` — start timer
- [x] `POST /v1/tickets/:id/stop` — stop timer
- [ ] `POST /v1/tickets/batch-status` — batch status update
- [ ] `PUT /v1/tickets/:id/assign` — assign to user

---

## Phase 5 — Clock

**Effort:** 2–3 days  
**Goal:** Move clock in/out and timesheet to timecore. This phase has the highest real-time
requirement — the team dashboard shows live clock state for all members.

### timehuddle changes
- [ ] Replace 7 clock Meteor methods with REST calls
- [ ] Replace `clockEventsForUser` publication with REST + refresh on action
- [ ] Replace `clockEventsForTeams` publication with **SSE** stream
- [ ] Remove `imports/features/clock/api.ts` server half
- [ ] Member Activity page — team-admin view of a specific member's clock history, tickets worked, and message thread

### timecore changes
- [ ] `POST /v1/clock/start` — clock in
- [ ] `POST /v1/clock/stop` — clock out
- [ ] `POST /v1/clock/:id/ticket/start` — start ticket timer in clock event
- [ ] `POST /v1/clock/:id/ticket/stop` — stop ticket timer
- [ ] `PUT /v1/clock/:id/times` — admin adjust times
- [ ] `PUT /v1/clock/:id/youtube` — attach YouTube link
- [ ] `GET /v1/clock/timesheet` — query timesheet data
- [ ] `GET /v1/clock/live?teamIds=` — **SSE** — live clock state for teams

---

## Phase 6 — Messages

**Effort:** 1–2 days  
**Goal:** Move the admin↔member messaging system to timecore with SSE for real-time delivery.

### timehuddle changes
- [ ] Replace `messages.send` Meteor method with `POST /v1/messages`
- [ ] Replace `messages.thread` publication with **SSE** stream per thread
- [ ] Remove `imports/features/messages/api.ts` server half

### timecore changes
- [ ] `GET /v1/messages?teamId=&adminId=&memberId=` — fetch thread
- [ ] `POST /v1/messages` — send message
- [ ] `GET /v1/messages/stream?threadId=` — **SSE** — live message delivery

---

## Phase 7 — Push Notifications

**Effort:** 1 day  
**Goal:** Move VAPID/FCM handling to timecore. The existing `public/sw.js` is already
Meteor-independent and stays as-is.

### timehuddle changes
- [ ] Replace `getVapidPublicKey`, `push.subscribe`, `push.unsubscribe` Meteor methods
- [ ] Remove `imports/server/push.ts`
- [ ] Remove `imports/lib/pushNotificationsClient.ts` Meteor dependency

### timecore changes
- [ ] `GET /v1/push/vapid-key` — return public VAPID key
- [ ] `POST /v1/push/subscribe` — store subscription
- [ ] `DELETE /v1/push/subscribe` — remove subscription
- [ ] Move web-push + FCM sending logic from Meteor into timecore service

---

## Phase 8 — Notifications

**Effort:** 1 day  
**Goal:** Move the notifications inbox to timecore with SSE for real-time delivery.

### timehuddle changes
- [ ] Replace `notifications.inbox` publication with SSE stream + REST for mark-read/delete
- [ ] Remove notifications server code from `imports/features/notifications/`

### timecore changes
- [ ] `GET /v1/notifications` — paginated inbox
- [ ] `POST /v1/notifications/read` — mark all read
- [ ] `PATCH /v1/notifications/:id/read` — mark one read
- [ ] `DELETE /v1/notifications/:id` — delete one
- [ ] `GET /v1/notifications/stream` — SSE stream for new notifications

---

## Phase 9 — GitHub Integration

**Effort:** 1–2 days  
**Goal:** Allow users to connect their GitHub account via OAuth, browse repos/issues, and link GitHub issues to tickets — parity with timeharbor-legacy.

### timehuddle changes
- [ ] GitHub OAuth connect button in Profile settings (opens popup, stores token on success)
- [ ] Ticket detail — "Link GitHub Issue" picker (search repos → issues)
- [ ] Display linked GitHub issue title/URL on ticket

### timecore changes
- [ ] `GET /api/github/callback` — OAuth callback: exchange code for token, store on user record
- [ ] `POST /v1/github/connect` — initiate OAuth flow (returns authorization URL + state)
- [ ] `DELETE /v1/github/disconnect` — remove stored token
- [ ] `GET /v1/github/repos` — list user's repos (proxied through stored token)
- [ ] `GET /v1/github/repos/:owner/:repo/issues` — list open issues
- [ ] `GET /v1/github/status` — return whether current user has GitHub connected

---

## Phase 10 — PulseVault Integration

**Effort:** 1 day  
**Goal:** Allow users to attach media to tickets via PulseCam app using a QR code/deeplink — parity with timeharbor-legacy.

### timehuddle changes
- [ ] Ticket detail — "Attach Media" button that shows PulseVault QR code / deeplink
- [ ] Display attached media previews on ticket once uploaded

### timecore changes
- [ ] `POST /v1/tickets/:id/pulse-upload` — get or create PulseVault draft (calls PulseVault API, caches result)
- [ ] `GET /v1/tickets/:id/pulse-upload` — return cached draft/deeplink for a ticket
- [ ] Store `pulseDrafts` records in MongoDB (mirrors legacy `PulseDrafts` collection)

---

## Phase 11 — Rip Out Meteor

**Effort:** 1 day  
**Goal:** Remove the Meteor build system and all remaining Meteor packages. Replace the dev
server with Vite. The app becomes a plain React SPA.

### timehuddle changes
- [ ] Add User Guide page (`/app/guide`) — static help/documentation, parity with legacy `/guide`
- [ ] Remove `server/` directory
- [ ] Remove `imports/startup/` directory
- [ ] Remove remaining `imports/features/*/api.ts` server sections
- [ ] Replace all `useTracker` + `useSubscribe` calls with TanStack Query hooks
- [ ] Replace `useMethod` utility with typed `fetch` wrappers (`imports/lib/api.ts`)
- [ ] Replace `meteor run` / Meteor build system with **Vite**
- [ ] Remove `.meteor/` directory and all `meteor/*` package imports
- [ ] Remove `@types/meteor` and meteor-related devDependencies
- [ ] Verify `public/sw.js` still registers correctly under Vite's static file serving

### Validation
- [ ] `npm run build` succeeds with no Meteor references
- [ ] Auth flow works end-to-end with timecore
- [ ] All SSE streams connect and deliver events
- [ ] Push notifications subscribe and fire
- [ ] No `meteor/` imports remain (`grep -r "meteor/" src`)

---

## Post-Migration: Mobile Path

Once Meteor is removed the codebase is universally portable:

| Target | Additional work |
|---|---|
| **PWA** | Add `manifest.json`, done — `sw.js` already exists |
| **Capacitor** | `npx cap init`, wrap existing React app, ~1 week |
| **Expo (React Native)** | Shared TanStack Query hooks + API layer, new native UI layer |

better-auth supports cookie auth (web) and token auth (mobile) natively — no changes needed
to timecore when adding mobile clients.

---

## Future — Needs Issues Filed

These features exist in timeharbor-legacy but are not yet covered by any phase above.
File a GitHub issue for each before starting the affected phase.

- [ ] **URL title fetch** — when a ticket is created with a reference URL, the server fetches the page title automatically (`extractUrlTitle` method). Needs a timecore endpoint (e.g. `POST /v1/util/extract-url-title`) and timehuddle ticket form integration. *(related: Phase 4)*
- [ ] **Ticket time history** — per-ticket time breakdown by configurable date range (today / yesterday / this week / this month / quarter / year / custom). Used in the ticket detail view (`getTicketTimeHistory` method). Needs a timecore endpoint (e.g. `GET /v1/tickets/:id/time-history?range=`) and timehuddle ticket detail UI. *(related: Phase 4)*
- [ ] **Auto clock-out background job** — server-side job that force-clocks-out any session running for 8+ consecutive hours (burnout prevention), fires push notifications to user and team admins. In legacy this is a `Meteor.setInterval` running every 60 seconds on the server. Needs a scheduled job in timecore (Node `setInterval` or a cron package) that replicates this logic. *(related: Phase 5)*
