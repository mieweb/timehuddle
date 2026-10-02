/**
 * Huddle Composer — responsiveness.
 *
 * The composer sits in a bounded flex column between the page header and the
 * fixed mobile bottom nav. Expanded, it is taller than that gap on a short
 * viewport, so unless its container can scroll the overflow the lower half
 * — Ticket, @Mention and the post button — is clipped underneath the
 * nav and unreachable. That regression is invisible on a desktop viewport and
 * on a tall phone, so it is pinned here at the narrowest size the app supports.
 *
 * Driven through the Clock tab's plan composer (same editor and attach bar as
 * the Huddle composer), with the shared team's plan gate on.
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { composerEditor, openComposer, setSharedTeamPlanGate } from './helpers';

const ACTION_BUTTONS: Array<string | RegExp> = [
  'Photo',
  'Doc',
  'Ticket',
  '@Mention',
  /(Post|Publish) plan and clock in/,
];

/**
 * Scrolls a control into view within the composer and reports whether it is
 * actually usable, with enough detail to tell *how* it failed.
 */
async function reachability(page: Page, name: string | RegExp): Promise<string> {
  const button = page.getByRole('button', { name, exact: typeof name === 'string' });
  const count = await button.count();
  if (count !== 1) return `matched ${count} elements`;

  await button.scrollIntoViewIfNeeded().catch(() => {});
  if (!(await button.isVisible().catch(() => false))) return 'not visible';

  const box = await button.boundingBox();
  if (!box) return 'no bounding box';

  // A control hidden behind the fixed bottom nav is "visible" to the DOM but
  // cannot be clicked, so check the geometry too. The nav stays in the DOM at
  // desktop widths (it is `md:hidden`, i.e. display:none) where it reports an
  // all-zero rect — treat that as "no nav" rather than "nothing below y=0".
  const navTop = await page.evaluate(() => {
    const rect = document.querySelector('nav.bottom-nav')?.getBoundingClientRect();
    return rect && rect.height > 0 ? rect.top : Number.POSITIVE_INFINITY;
  });
  const limit = Math.min(navTop, page.viewportSize()!.height);
  if (box.y < 0) return `above the viewport (y=${Math.round(box.y)})`;
  if (box.y + box.height > limit) {
    return `below the usable area (bottom=${Math.round(box.y + box.height)}, limit=${Math.round(limit)})`;
  }
  return 'reachable';
}

test.describe('Huddle composer — responsive layout', () => {
  test.setTimeout(120000);

  test.beforeAll(() => setSharedTeamPlanGate(true));
  test.afterAll(() => setSharedTeamPlanGate(false));

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
  });

  for (const viewport of [
    { label: 'small phone', width: 320, height: 568 },
    { label: 'phone', width: 390, height: 844 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'desktop', width: 1280, height: 900 },
  ]) {
    test(`every composer control is reachable at ${viewport.label} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openComposer(page);
      await composerEditor(page).fill('Responsive check');

      for (const name of ACTION_BUTTONS) {
        expect(
          await reachability(page, name),
          `"${name}" at ${viewport.width}x${viewport.height}`,
        ).toBe('reachable');
      }

      // Nothing may force the page itself to scroll sideways.
      const overflowsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflowsHorizontally).toBe(false);
    });
  }

  test('the composer scrolls its own overflow instead of clipping it', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openComposer(page);
    await composerEditor(page).fill('Overflow check');

    const screen = page.locator('.clock-screen');
    const { scrollHeight, clientHeight, canScroll } = await screen.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      canScroll: getComputedStyle(el).overflowY === 'auto',
    }));

    expect(canScroll).toBe(true);
    // The composer is genuinely taller than its slot here — that is the whole
    // point of the test; its container must absorb the excess rather than
    // overflow it.
    expect(scrollHeight).toBeGreaterThan(clientHeight);
  });
});
