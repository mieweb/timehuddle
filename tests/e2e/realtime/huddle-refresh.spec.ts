/**
 * Huddle feed refresh tests.
 *
 * Covers two user-facing behaviors on the Huddle page:
 *   1. Posting — a new post created via the composer shows up in the feed.
 *   2. Pull-to-refresh — swiping down at the top of the feed re-fetches posts
 *      over REST (`huddle.getPosts`). This matters on mobile, where the DDP
 *      live socket is dropped while the app is backgrounded (e.g. to record a
 *      Pulse video), so the manual refresh is the reliable update path.
 *
 * Pull-to-refresh only activates on touch-capable devices, so this suite uses
 * a `hasTouch` context and dispatches a real touch drag over the feed via CDP.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { openPostInInbox, postFromHuddle } from '../huddle/helpers';
import { pullToRefresh } from '../fixtures/refresh';

test.describe('Huddle Feed Refresh', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    // Touch-enabled context — pull-to-refresh is a no-op on non-touch devices.
    context = await browser.newContext({ hasTouch: true });
    page = await context.newPage();

    await loginAs(page, TEST_USERS.admin1);
    await selectSharedTestTeam(page);
    await page.goto('http://localhost:3002/app/huddle');
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('creates a post and shows it in the feed', async () => {
    const uniqueText = `Refresh test post ${Date.now()}`;
    await postFromHuddle(page, uniqueText);

    // The new post appears without a manual reload (post → refreshFeed).
    await openPostInInbox(page, uniqueText);
  });

  test('pull-to-refresh re-fetches the feed over REST', async () => {
    // Delay the refresh response so the "Refreshing..." indicator stays visible
    // long enough to assert deterministically (the fetch is otherwise too fast).
    await page.route(/huddle_getPosts/, async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });

    // Capture the REST call that a refresh triggers. Set up the wait right
    // before the gesture so it matches the pull, not the initial-load fetch.
    const refreshRequest = page.waitForRequest((req) => /huddle_getPosts/.test(req.url()), {
      timeout: 15000,
    });

    await pullToRefresh(page);

    // The refreshing indicator confirms the gesture engaged the handler...
    await expect(page.getByText('Refreshing...')).toBeVisible({ timeout: 5000 });
    // ...and the REST refetch confirms the feed actually reloaded.
    await refreshRequest;
  });

  test('pull-to-refresh spinner clears and shows an error toast when the refresh hangs', async () => {
    // Simulate the bug this issue is about: the handler the refresh waits on
    // never settles (e.g. a half-open DDP socket after backgrounding). The
    // route is simply never fulfilled, so the page's refetch hangs forever.
    await page.route(/huddle_getPosts/, () => {
      // Intentionally never calls route.continue()/fulfill().
    });

    await pullToRefresh(page);
    await expect(page.getByText('Refreshing...')).toBeVisible({ timeout: 5000 });

    // RefreshContext's REFRESH_TIMEOUT_MS is 10s — the spinner must clear
    // within a short margin of that, not hang alongside the request.
    await expect(page.getByText('Refreshing...')).toBeHidden({ timeout: 13000 });
    await expect(page.getByText(/Couldn't refresh/)).toBeVisible({ timeout: 2000 });

    // The failed refresh must not leave pull-to-refresh blocked.
    await pullToRefresh(page);
    await expect(page.getByText('Refreshing...')).toBeVisible({ timeout: 5000 });
  });

  test('reload shows the feed (or empty state) without switching tabs', async () => {
    await page.reload();
    // The page's own loading spinner (distinct from pull-to-refresh's) must
    // clear on its own — via the DDP subscription becoming ready, the
    // loadingFallback timeout, or refreshFeed()'s REST fallback — without the
    // user having to switch tabs to unstick it.
    await expect(page.locator('.huddle-loading')).toHaveCount(0, { timeout: 15000 });

    // Either real posts (the pull-to-refresh container they render inside) or
    // the explicit empty state — poll briefly since the feed can mount a beat
    // after the spinner itself disappears.
    await expect
      .poll(
        async () => {
          const hasEmptyState = await page.getByText(/No posts/).count();
          const hasFeed = await page.locator('[data-testid="pull-to-refresh"]').count();
          return hasEmptyState > 0 || hasFeed > 0;
        },
        { timeout: 5000 },
      )
      .toBe(true);
  });
});
