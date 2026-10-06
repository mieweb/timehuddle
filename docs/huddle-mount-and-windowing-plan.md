# Huddle Mounting and Data Loading (#635)

Plan and execution log for [issue #635](https://github.com/mieweb/timehuddle/issues/635).

## Problem

1. Leaving Huddle and coming back remounts the inbox: the open conversation is lost and an empty "Today" flashes while posts load.
2. A first visit should land on Today.
3. The feed loads the team's whole history. It should load ~30 days, then the prior 30 days each time the end of the conversation list is seen.

### Root causes

| #   | Symptom                          | Cause                                                                                                                                                              |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Huddle remounts on every visit   | `AppLayout` renders only the current route's page; only `TicketsPage` is kept alive.                                                                               |
| B   | Open conversation is lost        | It lives only in `?conversation=`, and the sidebar links to a bare `/app/huddle`. The inbox's mobile list/chat state is internal and resets on remount.            |
| C   | "Today" with no posts flashes    | The starter conversation shows whenever `posts.length === 0`, so "not loaded yet" looks like "empty". The 3s `loadingFallback` and effect cleanup both trigger it. |
| D   | First visit isn't reliably Today | The default is `conversations[0]` (most recently active), which is Today only if there is a post today.                                                            |
| E   | Slow loading                     | `huddlePosts.byTeam` and `huddle.getPosts` return the entire history.                                                                                              |

## Solution

1. Keep Huddle mounted (generalize the `TicketsPage` special case into keep-alive). A hidden page gets a frozen router so it cannot read or write the visible page's URL; on re-activation Huddle restores its last `conversation`/`view`/`q` unless the URL carries explicit view params.
2. Track "loaded" per scope; show the starter only for a confirmed-empty load. Default to Today (Day grouping: today's thread, synthesized empty if needed).
3. Window by date: one `since` parameter honored by the publication, REST and the Personal scope. Initial window 30 days; each time the end of the list is seen, widen it by 30 days. The existing `huddlePosts.byTeam` subscription is reused, not replaced.

The end-of-list trigger needs a `listFooter` slot in `@mieweb/ui` (built in `vendor/ui`, sent upstream), per `AGENTS.md` Rule 14.

## Milestones

Run `nvm use` first; `npm run lint && npm run typecheck && npm run format && npm test` at the end of each.

### M0: Branch and plan

- [x] Branch `fix/huddle-mount-and-windowing-635` from `origin/main`
- [x] Commit this plan

### M1: Honest loading state (cause C)

- [x] Loading ends only on a confirmed snapshot (DDP ready or REST success); the 3s timer no longer ends it. After 10s with neither, a load error is shown instead of an empty feed
- [x] The starter conversation can no longer appear before a confirmed load (the inbox renders only after loading ends); the Personal view's loading flag starts true so its first render isn't empty
- [x] Posts are still cleared on team switch, but the spinner is up in the same render, so no empty frame
- [ ] Unit/e2e test: covered in M8 (the logic lives in component effects, no extractable unit)

### M2: Default to Today (cause D)

- [x] `defaultConversation()` in `superChatFeed.ts`, plus `withTodayConversation()`, which adds an empty Today (same id the first post lands in) to Day grouping when nobody has posted today
- [x] Used in `Huddle.tsx` instead of `conversations[0]`
- [x] Vitest cases (today exists, missing, other groupings, midnight rollover)

### M3: Date-windowed backend (cause E)

- [ ] `huddlePosts.byTeam(teamId, since)`: validate, default 30 days, bound the initial query (incl. legacy ObjectId `teamId`) and the change stream
- [ ] `huddle.getPosts({ teamId, since })` returns `{ posts, hasMore }`; `huddle.getMyPosts` returns `hasMore`
- [ ] Wormhole schemas and `api.ts` wrappers updated
- [ ] Backend tests (boundaries, legacy `teamId`, `hasMore`, bad `since`, non-member rejected)

### M4: Window state in the client

- [ ] `windowDays` / `since` / `hasMore` / `loadingOlder` state; reset on team/scope change
- [ ] Re-subscribe with the widened `since` (new subscription before the old one stops); pass `since` to REST and Personal fetches
- [ ] A failed load-older keeps existing posts and is retryable

### M5: `listFooter` slot in `@mieweb/ui` (needs approval)

- [ ] Approval obtained to change `vendor/ui`
- [ ] `listFooter` prop on `SuperChatConversations` / `SuperChatInbox` with story and test
- [ ] `npm run ui:build`; submodule pointer and tarball committed
- [ ] `docs/superchat-inbox-gaps.md` updated

### M6: Infinite-scroll sentinel

- [ ] `LoadOlderSentinel` (IntersectionObserver) in `listFooter`, only while `hasMore`; spinner while loading, "no older posts" at the end
- [ ] Re-arms after each load; loop guard for runs of empty windows
- [ ] aria-live, externalized strings, RTL-safe classes

### M7: Keep Huddle mounted (causes A and B)

- [ ] `KEEP_ALIVE_ROUTES` in `AppLayout` replaces the `TicketsPage` special case
- [ ] `useIsRouteActive()` and a frozen `RouterContext` for inactive keep-alive pages
- [ ] Huddle's URL-bound / global effects gated on active
- [ ] View restore on re-activation
- [ ] Scroll position survives hiding (thread and list)
- [ ] Team switch, logout/login, and notification deep link while hidden verified
- [ ] `ROUTING.md` updated

### M8: Tests

- [ ] Unit tests (default conversation, `loaded` gating, window math, sentinel, frozen router)
- [ ] Playwright specs (return to same conversation, first visit = Today, >30 days windowing, mobile, deep link while mounted)

### M9: Release and wrap-up

- [ ] Release note
- [ ] `npm run test:all`, lint, typecheck, format clean
- [ ] Browser smoke test

## Acceptance criteria

- Returning to Huddle shows the same conversation with no spinner and no empty-"Today" flash.
- First visit opens Today; empty Today is postable.
- "Today with no posts" only when data is confirmed empty.
- Initial load is 30 days; reaching the end of the list fetches the prior 30 until nothing is older.
- Live edits/deletes still update; posting works in Team and Personal scopes.
- A hidden Huddle never changes the visible page's URL or refresh behavior.
- Existing deep links (`?conversation=`, `?post=`, `?postId=`, `?view=me`) still work.

## Out of scope

Per-conversation lazy loading; server-side search of unloaded history; reworking the Personal scope beyond `since`/`hasMore`; unrelated e2e debt; moving other pages to keep-alive.
