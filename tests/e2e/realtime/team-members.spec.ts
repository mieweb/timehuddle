/**
 * Real-time team member synchronization.
 *
 * `TeamsPage` subscribes to the `teams` collection, so a membership change made
 * by one team admin must reach another admin's open page without a reload.
 * That is the assertion worth making here — the old version of this file only
 * compared two sessions' unchanged headings and list lengths, which would pass
 * with real-time sync entirely broken.
 *
 * Promoting a member to team admin is the mutation under test: `teams.admins`
 * is part of the published document, and "Remove Admin" undoes it through the
 * same UI, so the seeded team is left as it was found.
 *
 * Both sessions are seeded team admins of TEST01 — the ⋮ menu only renders for
 * admins, and only a second admin can observe the change.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';

/** A seeded plain member of TEST01, so the promotion has somewhere to go. */
const TARGET = TEST_USERS.member4;

const memberItem = (page: Page, name: string) =>
  page.locator('li').filter({ hasText: name }).first();

/** The crown badge a team admin carries in the member list. */
const adminBadge = (page: Page, name: string) => memberItem(page, name).getByText('Admin');

async function openTeamsPage(page: Page): Promise<void> {
  await selectSharedTestTeam(page);
  await page.goto('/app/teams');
  await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible({
    timeout: 20000,
  });
  await expect(memberItem(page, TARGET.name)).toBeVisible({ timeout: 20000 });
}

async function chooseMemberAction(page: Page, name: string, action: string): Promise<void> {
  await memberItem(page, name).getByRole('button', { name: 'Member actions' }).click();
  await page.getByText(action, { exact: true }).click();
}

test.describe('Real-time Team Members', () => {
  let session1: Page;
  let session2: Page;

  test.beforeEach(async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    await loginAs(session1, TEST_USERS.admin1);
    await loginAs(session2, TEST_USERS.admin2);

    await openTeamsPage(session1);
    await openTeamsPage(session2);

    await expect(adminBadge(session1, TARGET.name)).toHaveCount(0);
    await expect(adminBadge(session2, TARGET.name)).toHaveCount(0);
  });

  test.afterEach(async () => {
    // Demote again so the next spec inherits the seeded admin list.
    if ((await adminBadge(session1, TARGET.name).count()) > 0) {
      await chooseMemberAction(session1, TARGET.name, 'Remove Admin').catch(() => {});
      await expect(adminBadge(session1, TARGET.name)).toHaveCount(0, { timeout: 10000 });
    }
    await session1.close();
    await session2.close();
  });

  test('promoting a member to admin reaches the other admin without a reload', async () => {
    await chooseMemberAction(session1, TARGET.name, 'Make Admin');

    await expect(adminBadge(session1, TARGET.name)).toBeVisible({ timeout: 10000 });
    await expect(adminBadge(session2, TARGET.name)).toBeVisible({ timeout: 10000 });
  });

  test('demoting them again clears the badge in the other session', async () => {
    await chooseMemberAction(session1, TARGET.name, 'Make Admin');
    await expect(adminBadge(session2, TARGET.name)).toBeVisible({ timeout: 10000 });

    await chooseMemberAction(session1, TARGET.name, 'Remove Admin');

    await expect(adminBadge(session1, TARGET.name)).toHaveCount(0, { timeout: 10000 });
    await expect(adminBadge(session2, TARGET.name)).toHaveCount(0, { timeout: 10000 });
  });

  test('only the promoted member changes in the observing session', async () => {
    const bystander = TEST_USERS.member3;
    await expect(adminBadge(session2, bystander.name)).toHaveCount(0);

    await chooseMemberAction(session1, TARGET.name, 'Make Admin');
    await expect(adminBadge(session2, TARGET.name)).toBeVisible({ timeout: 10000 });

    await expect(adminBadge(session2, bystander.name)).toHaveCount(0);
  });
});
