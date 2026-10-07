/**
 * The organization chart is code-split. When its download fails (a dev
 * re-bundle, or a deploy that replaced the file an open tab asks for), the page
 * says so and offers a reload instead of going blank.
 */
import { expect, test } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';

test('a chart that fails to download shows a reload, not a blank page', async ({ page }) => {
  await loginAs(page, TEST_USERS.owner1);
  await page.route('**/src/features/org/OrganizationChart.tsx*', (route) => route.abort());

  await page.goto('/app/organization');

  const failed = page.getByRole('alert').filter({ hasText: 'didn’t load' });
  await expect(failed).toBeVisible({ timeout: 20000 });
  await expect(failed.getByRole('button', { name: 'Reload' })).toBeVisible();
  // The rest of the page is still there.
  await expect(page.getByRole('heading', { level: 1, name: 'Organization' })).toBeVisible();
});
