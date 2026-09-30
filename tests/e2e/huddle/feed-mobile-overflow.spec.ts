/**
 * Huddle feed — no sideways panning on a phone.
 *
 * The feed scrolls vertically, and `overflow-y: auto` computes `overflow-x` to
 * auto as well, so a single post wider than the screen let the whole feed pan
 * sideways: every card shifted left with its avatar and like count cut off and
 * a strip of page background showing on the right. The trigger in the wild was
 * a pasted GitHub URL run into the following text with no space, which a phone
 * can't fit on one line. Invisible at desktop width, so pinned at phone width.
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  composerEditor,
  openComposer,
  postContainer,
  submitPost,
  switchToCardView,
} from './helpers';

test.describe('Huddle feed — phone width', () => {
  test.setTimeout(120000);

  test('a long unbroken URL wraps inside its card instead of widening the feed', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);

    const marker = `wide-${Date.now()}`;
    await composerEditor(page).fill(
      `${marker} https://github.com/mieweb/timehuddle/pull/544(mieweb/UI-adoption-with-no-spaces)`,
    );
    await submitPost(page);
    await switchToCardView(page);
    const card = postContainer(page, marker);
    await expect(card).toBeVisible({ timeout: 15000 });

    const feed = page.locator('.huddle-feed');
    const { scrollWidth, clientWidth, overflowX } = await feed.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
    }));
    // Nothing inside the feed is wider than it…
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    // …and even if something were, the feed itself must not pan sideways.
    expect(overflowX).toBe('hidden');

    // Every card sits flush with the screen edges.
    for (const box of await page
      .locator('[data-testid="post-card"]')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) {
      expect(box.left).toBe(0);
      expect(box.right).toBe(393);
    }
  });
});
