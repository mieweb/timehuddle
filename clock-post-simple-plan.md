# Clock ↔ Huddle Plan-First Flow — Minimal Plan

The core loop, nothing else: **write today's plan as a Huddle post → clock in → edit that same post with a wrap-up → clock out.** Gated per team by one setting, off by default.

## What's in

- One team setting: `settings.requirePlanForClock` (default `false`), toggled by admins in the existing Team Settings modal.
- Posts get a `postDate` (`YYYY-MM-DD`) so "today's post" is a real query.
- Gate on: Clock In disabled until you have a post for today; Clock Out blocked until you've saved a wrap-up edit to it. Clear inline message when blocked — no modals, no overrides.
- Gate off (default): everything behaves exactly as today.
- The composer edits today's post if one exists instead of creating a second one. The existing `?prompt=clockin|clockout` redirects reopen it.
- Composer = `RichEditor` from `@mieweb/ui/kerebron` (Kerebron/ProseMirror, markdown in/out). Feed = `SuperChat` panel (`order="desc"`, read-only thread) so posts render rich markdown for free.

## Dependency prerequisite (blocks Milestones 4–5)

Work against `mieweb/ui` as a **git submodule** so we can build it locally and PR changes upstream (the repo already uses this convention: `vendor/meteor-wormhole`).

- [ ] `git submodule add https://github.com/mieweb/ui vendor/ui` (track `main`).
- [ ] Build it locally (`npm install && npm run build` inside `vendor/ui`) and point `package.json` at the build: `"@mieweb/ui": "file:vendor/ui"`.
- [ ] Smoke-test existing `@mieweb/ui` usage across the app (we're coming from 0.2.4 — budget for breaking changes).
- [ ] Wire the submodule build into dev docs/scripts so `nvm use && npm install` after a fresh clone doesn't silently break (submodule init + build step).
- [ ] Fallback/CI note: `@mieweb/ui@0.6.1-dev.169` is the closest published release with SuperChat + kerebron if `file:` causes CI friction; swap to the full release when it lands and drop the submodule once no local patches remain.

### Upstream PR from the submodule

- [ ] Branch in `vendor/ui`: add an `extensions`/`kits` prop to `RichEditor` so hosts can inject Kerebron extensions (e.g. `@kerebron/extension-yjs`) alongside the default `AdvancedEditorKit`.
- [ ] PR it to `mieweb/ui`; pin the submodule to our branch commit until merged, then move the pointer back to `main`.

Milestones 1–3 (setting, data model, gates) have no dependency on this and can land first.

## What's deliberately out (add later only if people ask)

- Drafts, "My Drafts" tab, `status` field, future-dated plans
- "Plan tomorrow before clocking out" requirement (needs drafts to work)
- Next-workday/weekend date math
- Override/confirm modals, readiness-checklist endpoints
- Live clock-status dot on posts

(Kerebron/Yjs live sync was deferred here previously — the submodule + upstream `extensions` prop PR unblocks it, so it's now stretch Milestone 7.)

---

## Milestone 1 — Team setting

- [x] `teams` doc: `settings.requirePlanForClock` (absent = `false`).
- [x] Admin-only `teams.updateSettings({ teamId, requirePlanForClock })` in `meteor-backend/server/teams.js` (copy the `teams.rename` auth pattern).
- [x] `Team` type + `teamApi.updateSettings` in `src/lib/api.ts`.
- [x] On/off toggle in the Team Settings modal in `src/features/teams/TeamsPage.tsx` (reuse `canManageTeamSettings`).

## Milestone 2 — Today's post

- [ ] `huddle.createPost`: accept `postDate` (client sends `toDateString(new Date())` from `src/lib/timeUtils.ts`).
- [ ] `huddle.updatePost`: accept optional `wrapUp: boolean` → sets `wrapUpAt: new Date()` on the post.
- [ ] `huddle.getMyPostForDate({ teamId, postDate })` → `{ post }` or `{ post: null }`.
- [ ] Frontend: `HuddlePost` gets `postDate` + `wrapUpAt`; `huddleApi.getMyPostForDate` wrapper; tiny `useDailyPost(teamId)` hook returning `{ todayPost, refetch }`.

## Milestone 3 — Gates

- [ ] `ClockPage.tsx`: when the team setting is on and there's no `todayPost`, disable Clock In with a one-line "Write today's plan first" link to Huddle. Setting off → unchanged.
- [ ] `clock.stop` in `meteor-backend/server/clock.js`: when the setting is on and today's post has no `wrapUpAt`, throw `Meteor.Error('plan-required', 'Add a wrap-up to today's post first')`. Setting off → unchanged.
- [ ] `useClockToggle` / `ClockPage.tsx`: show the `plan-required` message inline with a link to Huddle.

## Milestone 4 — Composer → RichEditor (Kerebron)

- [ ] Install `@kerebron/editor`, `@kerebron/editor-kits`, `@kerebron/wasm`; import `@mieweb/ui/kerebron.css`.
- [ ] Serve `@kerebron/wasm`'s `assets/` at `/kerebron-wasm` (Vite static copy or `publicDir` alias — the editor fetches tree-sitter grammars from there at runtime).
- [ ] Swap the Huddle composer's textarea for `<RichEditor value onChange />` (markdown out). Posts store markdown in the existing `content` field — plain-text legacy posts render fine as markdown.
- [ ] `RichEditor` is uncontrolled (initial `value` applies on mount only) — remount it via `key={editingPostId ?? 'new'}` when switching between new-post and edit-today's-post.
- [ ] If `todayPost` exists, the composer opens it for editing and submit updates instead of creating.
- [ ] `?prompt=clockout` submit passes `wrapUp: true`.
- [ ] Refetch `todayPost` after create/update so the Clock In gate flips live (reuse the existing `work:refetch`-style window event).

## Milestone 5 — Feed → SuperChat panel

- [ ] Map huddle posts → a `SuperChatConversation`: one participant per team member (name/avatar → `participants`), one message per post (`createdAt`, markdown `text`).
- [ ] Render `<SuperChat order="desc" readOnly virtualized>` for the feed — newest-first, composer disabled (authoring goes through the RichEditor above the feed, since SuperChat's built-in composer can't be swapped out).
- [ ] Enable `renderPlugins` (`createCodePlugin`, `createImagePlugin`, `createMermaidPlugin`) as wanted; skip math/KaTeX.
- [ ] Wire `onMessageEdited` (self-authored messages only) → `huddle.updatePost`, so "edit today's post" also works inline from the feed.
- [ ] Decide comment handling: keep the existing per-post comment UI outside SuperChat for v1 (SuperChat has no per-message thread concept) — don't force-fit it.

## Milestone 6 — Verify

- [ ] Backend tests: gate off → clock in/out unchanged; gate on → in blocked without today's post, out blocked without wrap-up, both pass once satisfied.
- [ ] `npm run lint && npm run typecheck && npm run test:all` clean.
- [ ] Manual: publish plan (RichEditor) → clock in → wrap-up edit via clock-out prompt → clock out; confirm no duplicate post in the SuperChat feed and legacy plain-text posts still render.

## Milestone 7 (stretch) — Live collaborative sync (Yjs)

Only after the upstream `extensions` prop PR merges (or against our pinned submodule branch). Ship independently of 1–6.

- [ ] `/yjs` WebSocket route on the existing server: `y-websocket`'s `setupWSConnection` attached to the HTTP server on its own path (clear of DDP's `/websocket`), auth via the same token-in-query pattern as the other WS routes.
- [ ] Room per post id; Y.Doc held in memory, seeded from the post's stored markdown on first join. Markdown stays the source of truth — saves still go through `huddle.updatePost`, no Y.Doc persistence layer.
- [ ] Wire `@kerebron/extension-yjs` into `RichEditor` via the new `extensions` prop, room = post id.
- [ ] Verify: same post open in two browsers → edits and cursors sync live; a save from either persists the merged markdown.
