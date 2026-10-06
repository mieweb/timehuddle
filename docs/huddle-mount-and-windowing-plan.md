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

- [x] `huddlePosts.byTeam(teamId, since)`: validated, defaults to 30 days, bounds the initial query (incl. legacy ObjectId `teamId`) and the change stream. Note: `DashboardPage` and `useSessionPost` subscribe without `since`, so they get the 30-day default too
- [x] `huddle.getPosts({ teamId, since })` returns `{ posts, hasMore }`; `huddle.getMyPosts` returns `hasMore`; shared `resolveSince` lives in `server/huddle-window-core.js`
- [x] Wormhole schemas and `api.ts` wrappers (`HuddleFeedPage`) updated; `huddlePosts` gets `{teamId, createdAt}` and `{userId, createdAt}` indexes
- [x] Backend tests (`huddle-window-core.test.ts`; window, `hasMore`, bad `since`, non-member in `huddle-post-rest.test.ts`)

### M4: Window state in the client

- [x] `useFeedWindow` hook (`windowDays` / `since` / `hasMore` / `loadingOlder` / `loadFailed`), one window per feed, reset on team change; unit-tested
- [x] The team subscription re-subscribes with the widened `since` without blanking posts (the REST snapshot holds the screen); `since` is passed to the REST and Personal fetches
- [x] A failed load-older keeps existing posts and waits for an explicit retry (`retry()`); nothing triggers `loadOlder` yet (M6)

### M5: `listFooter` slot in `@mieweb/ui` (needs approval)

- [x] Change made in `vendor/ui` on the existing PR branch (already vendored); nothing pushed or opened as a PR yet
- [x] `listFooter` prop on `SuperChatConversations` / `SuperChatInbox` with story control, README rows and tests (70/70 SuperChat tests pass)
- [x] `npm run ui:build`; submodule pointer, tarball, marker and lockfile committed
- [x] `docs/superchat-inbox-gaps.md` updated
- [ ] **Before merging:** `git -C vendor/ui push` (commit `7c3490ab`), otherwise the submodule pointer references a commit nobody else can fetch (CI uses the tarball, so it is unaffected)

### M6: Infinite-scroll sentinel

- [x] `LoadOlderSentinel` (IntersectionObserver) in `listFooter`, only while `hasMore`; spinner while loading, "No older posts" at the end, quiet until `hasMore` is known
- [x] Re-arms after each load, so a window that doesn't fill the list triggers the next one
- [x] Loop guard: a failed load stops auto-loading until Retry. A run of empty windows costs one cheap request per 30 days of gap and is bounded by the team's history; no extra cap
- [x] aria-live region, labelled spinner and Retry button; strings are inline like the rest of the page (the app has no i18n layer yet); no left/right classes

### M7: Keep Huddle mounted (causes A and B)

Design change from the first draft: React 19.2's `<Activity>` does the keep-alive, so the frozen
router and `useIsRouteActive` are not needed. A hidden `<Activity>` keeps state and DOM but pauses
every effect, so a hidden Huddle can't write the visible page's URL, register pull-to-refresh or hold
a DDP subscription.

- [x] `AppLayout` mounts Huddle on its first visit and wraps it in `<Activity mode>` (visible only on `/app/huddle`); `TicketsPage` keeps its own existing mechanism
- [x] Huddle's loading effects survive being paused: posts are cleared only when the team actually changes, not on every effect cleanup; the load timeout is its own effect
- [x] View restore: Huddle remembers `conversation`/`view`/`q` while on screen and puts them back (layout effect, before paint) when it returns to a bare URL; a link that names a view wins
- [x] Verified by e2e: same conversation and search restored with no spinner or starter flash; a `?post=` link wins over the remembered conversation
- [x] Scroll position of the conversation list survives hiding (e2e, 25 days of posts)
- [x] On a phone, Huddle opens straight into the Today chat instead of the list: `defaultMobileView="chat"` on `SuperChatInbox` (new vendored prop, commit `1b1c7616`, push it with `7c3490ab`); e2e at 390px
- [x] Logout/login: `AppLayout` is keyed by user id (`main.tsx`), so a kept Huddle never outlives its session
- [x] `ROUTING.md` updated

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
