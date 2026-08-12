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

test.describe('Huddle Feed Refresh', () => {
  let context: BrowserContext;
  let page: Page;

  async function ensureCardView(p: Page): Promise<void> {
    const switchBtn = p.getByRole('button', { name: 'Switch to card view' });
    if (await switchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await switchBtn.click();
      await p.getByRole('button', { name: 'Switch to chat view' }).waitFor({ timeout: 5000 });
    }
    await p.waitForTimeout(1500);
  }

  /**
   * Fire pull-to-refresh by dispatching a synthetic touch drag directly on the
   * PullToRefresh container. Dispatching real DOM TouchEvents on the element
   * that owns the listeners is far more reliable than CDP coordinate hit-tests
   * (the sticky header sits outside the gesture container).
   */
  async function pullToRefresh(p: Page): Promise<void> {
    await p.evaluate(() => {
      const el = document.querySelector('[data-testid="pull-to-refresh"]') as HTMLElement | null;
      if (!el) throw new Error('PullToRefresh container not found');
      const main = el.closest('main');
      if (main) main.scrollTop = 0;

      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y0 = rect.top + 5;

      const event = (type: string, clientY: number): TouchEvent => {
        const touch = new Touch({
          identifier: 0,
          target: el,
          clientX: x,
          clientY,
          pageX: x,
          pageY: clientY,
        });
        const ended = type === 'touchend';
        return new TouchEvent(type, {
          cancelable: true,
          bubbles: true,
          touches: ended ? [] : [touch],
          targetTouches: ended ? [] : [touch],
          changedTouches: [touch],
        });
      };

      el.dispatchEvent(event('touchstart', y0));
      // Drag down past ACTIVATION_PX (15) and the release threshold (dy ≥ 75).
      for (let i = 1; i <= 10; i++) el.dispatchEvent(event('touchmove', y0 + i * 25));
      el.dispatchEvent(event('touchend', y0 + 250));
    });
  }

  test.beforeEach(async ({ browser }) => {
    // Touch-enabled context — pull-to-refresh is a no-op on non-touch devices.
    context = await browser.newContext({ hasTouch: true });
    page = await context.newPage();

    await loginAs(page, TEST_USERS.admin1);
    await page.goto('http://localhost:3002/app/huddle');
    await page.waitForLoadState('networkidle');

    await selectSharedTestTeam(page);
    await ensureCardView(page);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('creates a post and shows it in the feed', async () => {
    const postCards = page.locator('[data-testid="post-card"]');
    const initialCount = await postCards.count();

    const uniqueText = `Refresh test post ${Date.now()}`;

    // The composer starts collapsed; its editing surface is a ProseMirror
    // contenteditable, not a <textarea>.
    await page.getByText('Share an update...').click();
    const editor = page.locator('.markdown-editor .ProseMirror').first();
    await editor.waitFor({ state: 'visible', timeout: 5000 });
    await editor.fill(uniqueText);

    await page.getByRole('button', { name: 'Post', exact: true }).click();

    // The new post appears without a manual reload (addPost → refreshFeed).
    await expect
      .poll(async () => postCards.count(), { timeout: 15000 })
      .toBeGreaterThan(initialCount);
    await expect(postCards.filter({ hasText: uniqueText }).first()).toBeVisible({ timeout: 15000 });
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
});
