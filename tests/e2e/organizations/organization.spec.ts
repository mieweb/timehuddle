/**
 * Organization E2E Tests
 *
 * 1. Organization chart renders even when user is not part of any team
 */
import { test, expect } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';

test.describe('Organization', () => {
  test('should render org chart even without team membership', async ({ page }) => {
    // Login as a member who may not be in any non-personal team
    await loginAs(page, TEST_USERS.member5);

    await page.goto('/app/organization');
    await page
      .getByRole('heading', { level: 1, name: 'Organization' })
      .waitFor({ state: 'visible' });

    // Verify correct URL
    expect(page.url()).toContain('/app/organization');

    // Wait for chart to load (it may show "Loading chart" first)
    await page.waitForTimeout(5000);

    // The org chart tree should be visible
    const orgChart = page.getByRole('tree', { name: 'Organizational Chart' });
    await expect(orgChart).toBeVisible({ timeout: 15000 });

    // Verify chart has tree items (org members)
    const treeItems = page.getByRole('treeitem');
    const count = await treeItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should render org chart for owner with all members visible', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);

    await page.goto('/app/organization');
    await page
      .getByRole('heading', { level: 1, name: 'Organization' })
      .waitFor({ state: 'visible' });
    await page.waitForTimeout(5000);

    // Verify members count
    await expect(page.getByText(/Members: \d+/)).toBeVisible({ timeout: 10000 });

    // The org chart should be visible
    const orgChart = page.getByRole('tree', { name: 'Organizational Chart' });
    await expect(orgChart).toBeVisible({ timeout: 15000 });

    // Verify chart controls are available
    await expect(page.getByRole('button', { name: 'Fit to Screen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset Position' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse All' })).toBeVisible();

    // Verify search is available
    await expect(page.getByPlaceholder('Search organization...')).toBeVisible();

    // Verify Refresh button
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });
});
