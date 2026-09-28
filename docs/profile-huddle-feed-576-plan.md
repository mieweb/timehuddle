# Profile Feed Shows Huddle Posts — Issue #576 Working Plan

Tracking doc for [#576](https://github.com/mieweb/timehuddle/issues/576).
Branch: `feat/profile-huddle-feed-576` (cut from `main`)

Read the issue first. It defines **what** the feature does. This doc covers **how**
to build it and **in what order**.

---

## How to work through this doc

1. **One step = one commit.** When a step is done, change its `- [ ]` to `- [x]`
   in this file and include that edit **in the same commit** as the code. That
   way the log and the checklist can't disagree.
2. **Use the commit message given on the step.** The messages follow the repo's
   conventional-commit style (`feat(scope): …`, `refactor(scope): …`,
   `test(e2e): …`, `docs(release-notes): …`). A step marked _(no commit)_ is a
   check: tick its box together with the next commit.
3. **Pass the milestone gate before starting the next milestone.** If the gate
   fails, fix it in a new commit. Don't amend earlier commits: keeping one commit
   per step means any step can be backed out with `git revert`.
4. **Push at the end of every milestone** so progress shows up on the branch.
5. **Stuck for more than ~30 minutes, or a step doesn't match what you see in the
   code?** Stop and ask. Don't work around it. Every line reference below was
   correct when this doc was written, but code moves.

Before running any Node command: `nvm use`.

### Validation commands

| Command                           | What it checks                                  |
| --------------------------------- | ----------------------------------------------- |
| `npm run lint`                    | ESLint                                          |
| `npm run typecheck`               | `tsc --noEmit`                                  |
| `npm run format`                  | Prettier (fix with `npm run format:fix`)        |
| `npm run test:unit`               | Vitest                                          |
| `npm run test:e2e -- <spec path>` | One Playwright spec (needs the test backend up) |
| `npm run test:all`                | Vitest + the full Playwright suite (slow)       |

> If e2e logins hang on "Please wait…", the test backend has crashed even though
> `/health` still answers. Check `pm2 logs`, then restart `timehuddle-meteor-test`.

---

## Decisions already made

Build against these. Don't reopen them in the PR.

- **D1: Hook + component.** The feed is extracted as a hook (`useHuddlePosts`: data
  and loading) plus a component (`HuddleFeed`: permissions and the `PostCard` list).
  `Huddle.tsx` keeps the composer, search, drafts, SuperChat view and deep-link
  highlight.
- **D2: Optional `userId`.** The backend gets an optional `userId` on the existing
  `huddle.getPosts` method and `huddlePosts.byTeam` publication. No new method names.
- **D3: Plain strings.** New UI text follows the existing convention: plain strings
  in the component, like the current tab labels. No i18n library is added in this
  issue.
- **D4: Release-note version.** The note goes in whatever version `package.json`
  holds when this merges. If `release-notes/<that version>.md` exists, add a section
  to it; otherwise create it. See `release-notes/README.md`.

---

## Milestone 0: Setup

- [x] **0.1** Branch off an up-to-date `main`:
      `git checkout main && git pull && git checkout -b feat/profile-huddle-feed-576`.
      _(no commit)_
- [x] **0.2** Check the baseline. `npm run lint && npm run typecheck && npm run format && npm run test:unit`
      all pass, and `npm run test:e2e -- tests/e2e/huddle` passes. Write down anything
      that was already failing **before** you changed anything. _(no commit; paste the
      results into the PR description later)_
- [x] **0.3** Commit this doc with 0.1 and 0.2 ticked.
      Commit: `docs: add working plan for #576 profile huddle feed`

**Baseline (2026-09-28, `main` @ `93954fa1`):** lint, typecheck and format clean;
test:unit 154/154; `tests/e2e/huddle` 45 passed, 2 skipped, 1 flaky
(`post-progress-bar.spec.ts` › "Post button is disabled while posting", passed on
retry). The flaky test was already flaky before this work.

---

## Milestone 1: Backend, filter posts by author

Files: `meteor-backend/server/huddle.js`, `meteor-backend/server/main.js`

- [x] **1.1** Add a small helper near the top of `huddle.js` that builds the
      published-posts filter, e.g. `feedFilter(teamId, userId)` →
      `{ teamId, ...PUBLISHED, ...(userId ? { userId } : {}) }`. Both the method and
      the publication will call it, so the filter lives in one place.
      Commit: `refactor(huddle): share the published-posts filter`

- [x] **1.2** Update `huddle.getPosts({ teamId, userId })` (around line 291):

  - Accept an optional `userId`. If it's present and not a string, throw
    `bad-request`.
  - Replace the inline `find` filter with the helper.
  - **Leave the `requireIdentity` and team-membership check exactly as they are.**

  Commit: `feat(huddle): filter getPosts by author`

- [x] **1.3** Update `huddlePosts.byTeam(teamId, userId)` (around line 182):

  - Add the optional second argument, with the same validation as 1.2.
  - Use the helper for the main query, and add `userId` to the legacy
    ObjectId-`teamId` query too.
  - In the change-stream handler, right after the `teamId` check, `return` early
    when `userId` is set and `change.fullDocument.userId !== userId`.
  - Don't touch the draft or delete handling.

  Commit: `feat(huddle): filter the byTeam publication by author`

- [x] **1.4** In `main.js`, find `Wormhole.expose('huddle.getPosts', …)` (around
      line 1279) and add `userId: { type: 'string' }` to `properties`. Leave `required`
      as `['teamId']`. **Without this, REST calls that pass `userId` are rejected.**
      Commit: `feat(huddle): expose the author filter over REST`

- [x] **1.5** Check it by hand against the local backend, using the REST docs at
      `/api/docs` or curl with a bearer token. _(no commit; tick with the next commit)_

  - With `teamId` only: the full team feed, same as before.
  - With `teamId` + a member's `userId`: only that person's posts.
  - As a user who isn't in the team: `forbidden`.

**Gate:** 1.5 passes and the backend restarts cleanly. Push.

---

## Milestone 2: Frontend API client

- [x] **2.1** In `src/lib/api.ts` (around line 1167), change `getPosts` to take an
      optional `userId` and send it only when it's set:
      `getPosts: (teamId: string, userId?: string) => wormholeCall(..., { teamId, ...(userId ? { userId } : {}) })`.
      The existing call in `Huddle.tsx` compiles unchanged.
      Commit: `feat(api): accept an author filter on huddle getPosts`

**Gate:** `npm run typecheck`. Push.

---

## Milestone 3: Extract the shared feed (pure refactor)

**Nothing visible changes in this milestone.** Code **moves** out of
`src/pages/Huddle.tsx`; it isn't copied. If a reviewer diffs the moved code, it
should be almost identical.

- [x] **3.1** Create `src/features/huddle/useHuddlePosts.ts`, exporting
      `useHuddlePosts({ teamId, authorId }: { teamId: string | null; authorId?: string })`.

  Move these in from `Huddle.tsx`:

  - `posts` / `loading` / `error` state
  - `restPostsRef`
  - `syncPosts`, `refreshFeed`, `useRefresh(refreshFeed)`
  - the subscribe `useEffect`, including the 3s loading fallback

  Then change the moved code so that:

  - it subscribes with `authorId ? [teamId, authorId] : [teamId]`
  - it calls `huddleApi.getPosts(teamId, authorId)`
  - **in `syncPosts`, it also skips docs whose `userId !== authorId` when `authorId`
    is set.** This matters: the `huddlePosts` DDP cache is shared, and the dashboard
    keeps a full-team subscription open, so the cache holds other people's posts too.

  It returns `{ posts, loading, error, refresh: refreshFeed, isInFeed }`.
  `isInFeed(id)` is the `inFeed` check currently inside `addPost`.

  Commit: `refactor(huddle): extract feed loading into useHuddlePosts`

- [x] **3.2** Rewire `Huddle.tsx` to the hook. `addPost`'s retry loop calls
      `refresh()` and `isInFeed(id)`. Search, SuperChat, drafts and highlight still
      read `posts` from the hook.
      Commit: `refactor(huddle): drive the Huddle page from useHuddlePosts`

- [x] **3.3** Create `src/features/huddle/HuddleFeed.tsx`.

  Move these in from `Huddle.tsx`:

  - the team used for permissions — read it from `useTeam().allTeams` (live over
    DDP) instead of the page's one-off `teamApi.getTeamsOnly()` fetch
  - `canEditPost` / `canDeletePost`
  - the live-clock `activeClockEventIds` set
  - the `PostCard` `.map`

  Props: `teamId`, `posts`, `label`, `emptyState?: ReactNode`,
  `highlightedPostId?`. Render `emptyState` when `posts` is empty. Wrap the list in
  a `<section>` with a semantic class name and `aria-label={label}`. (Not
  `role="feed"`: that role requires `article` children, and `PostCard` isn't one.)

  Commit: `refactor(huddle): extract the post list into HuddleFeed`

- [x] **3.4** Render `<HuddleFeed>` in `Huddle.tsx`'s card view with
      `filteredPosts`, and delete the moved code from the page. Keep the page's own
      "No posts yet. Be the first to share!" block where it is: it also covers the
      chat view, so don't pass it as `emptyState`. Take the chat view's team name
      from `useTeam().selectedTeam`.
      Commit: `refactor(huddle): render the card view through HuddleFeed`

- [x] **3.5** Search `Huddle.tsx` for code the move left behind: unused imports,
      state or effects. Delete it. If there's nothing to delete, skip the commit but
      still tick the box.
      Commit: `refactor(huddle): drop code orphaned by the feed extraction`

**Gate (strict):** lint, typecheck, format and test:unit all pass, **and every spec
in `tests/e2e/huddle/` passes without modification.** If you had to edit a huddle
spec to make it pass, behavior changed. Stop and ask. Also open `/app/huddle` in
the browser: posting, editing, deleting, commenting, the chat view and search all
work. Push.

---

## Milestone 4: Profile changes

Files: `src/features/profile/ProfilePage.tsx`, `src/features/profile/ProfileFeed.tsx`

- [x] **4.1** Rename the media grid without changing its behavior:

  - `git mv src/features/profile/ProfileFeed.tsx src/features/profile/ProfileMedia.tsx`
  - Rename the component to `ProfileMedia` and update the import in
    `ProfilePage.tsx`.

  Commit: `refactor(profile): rename ProfileFeed to ProfileMedia`

- [x] **4.2** Create `src/features/profile/ProfilePosts.tsx` with the props
      `{ userId }`:

  - Get `selectedTeamId` from `useTeam()` (`src/lib/TeamContext.tsx`).
  - Call `useHuddlePosts({ teamId: selectedTeamId, authorId: userId })` and render
    `<HuddleFeed>`.
  - **No composer**, not even on your own profile.
  - Empty state when no team is selected: "Select a team to see posts."
  - Empty state when the person has no posts: "No posts in this team yet."

  Commit: `feat(profile): add ProfilePosts backed by the shared Huddle feed`

- [x] **4.3** Change the tab rail in `ProfilePage.tsx` (around line 422) to
      **Feed | Media | Work | Activity**:

  - Feed renders `<ProfilePosts userId={profile.id} />`.
  - Media renders `<ProfileMedia userId={profile.id} isOwn={isOwn} />`.
  - Update the `{/* Tab rail — … */}` comment to match.

  Commit: `feat(profile): show Huddle posts on Feed and move media to a Media tab`

- [x] **4.4** Check by hand in the browser. _(no commit; note any problem and fix it
      in its own commit)_

  - [x] Clicking a post author's avatar or name in Huddle opens their profile on
        **Feed**, showing only their posts.
  - [x] Switching teams in the team picker updates the list.
  - [x] Edit and delete show for the author, a team admin and the org owner, and
        not for anyone else. An edit shows up live in a second browser.
  - [x] Comments and reactions work.
  - [x] `?tab=media` opens Media. Upload works as it did before.
  - [x] Tabbing through the tabs and posts works with the keyboard, with a visible
        focus ring.
  - [x] At phone width (≈390px) the feed doesn't scroll sideways.

**Gate:** lint, typecheck, format and test:unit pass. Push.

---

## Milestone 5: Tests

- [x] **5.1** Read `tests/e2e/teams/profile-routing.spec.ts`. If it asserts on the
      old Feed content (the media grid or the Upload button on the Feed tab), update it
      to look on the Media tab. Skip the commit if no change is needed.
      Commit: `test(e2e): follow the media grid to the profile Media tab`

- [x] **5.2** Add `tests/e2e/pages/ProfilePage.ts`: a page object with
      `gotoUser(userId, tab?)`, `tab(name)`, `openTab(name)`, `feedPosts()` and `feedPost(text)` (`goto(url)` is taken by `BasePage`). Follow the pattern in
      `tests/e2e/pages/HuddlePage.ts`.
      Also move `getUserIdByEmail` out of `notifications/deep-links.spec.ts` into
      `fixtures/users.ts` so the new spec can share it rather than copy it.
      Commit: `test(e2e): add a profile page object`

- [ ] **5.3** Add `tests/e2e/huddle/profile-feed.spec.ts`. Seed with the helpers in
      `tests/e2e/huddle/helpers.ts`: two users in one team, each with a post. Cover:

  - [ ] Avatar click → profile Feed shows only that author's posts
  - [ ] No composer on the profile Feed, including your own profile
  - [ ] Edit and delete visible to the author and hidden from a plain teammate
  - [ ] A comment added on the profile feed shows up
  - [ ] Empty state for a user with no posts in the team
  - [ ] Media tab shows the Upload button on your own profile

  Commit: `test(e2e): cover the profile Huddle feed`

**Gate:** `npm run test:all` passes. Push.

---

## Milestone 6: Release note

- [ ] **6.1** Read `release-notes/README.md` in full, then add a section per D4.
      Write it for users, not developers:

  - A person's profile Feed now shows their Huddle posts in your current team.
  - Uploaded screenshots and videos moved to a new Media tab.
  - A screenshot is welcome. Put it in `release-notes/assets/<version>/`.

  Commit: `docs(release-notes): note profile Huddle posts and the Media tab`

- [ ] **6.2** `npm run dev` → open `/release-notes` and confirm the note shows. A
      bad version, date or image path silently drops the note, so this check is the
      only one there is. _(no commit)_

---

## Milestone 7: Pull request

- [ ] **7.1** Do a final pass against the checklist in `CLAUDE.md` (DRY, no dead
      code, ARIA, `@mieweb/ui` components) and against every acceptance criterion in
      #576.
- [ ] **7.2** Open the PR against `main`. Title:
      `feat: show a person's Huddle posts on their profile Feed`. In the body, include:

  - a link to #576 (`Closes #576`)
  - the baseline results from 0.2
  - a screenshot of the profile Feed and Media tabs
  - the acceptance criteria copied from the issue and ticked

  Commit (ticks 7.1 and 7.2): `docs: mark #576 plan complete`

- [ ] **7.3** Request review. Once the PR merges, delete this doc in a follow-up
      commit. The issue and the PR are the lasting record.
