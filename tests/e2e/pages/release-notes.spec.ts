/**
 * Release Notes E2E Tests
 *
 * Covers what only the real browser can show: that the markdown bundled from
 * `release-notes/` at build time reaches the page and renders as structured
 * HTML rather than raw text.
 *
 * The seen-marker itself is covered where it can be asserted properly —
 * `meteor-backend/tests/release-notes-seen.test.ts` for the persistence rules,
 * and `src/features/release-notes/notes.test.ts` for which notes count as
 * unread. Neither is observable here: E2E users are created the same day the
 * note ships, so nothing is flagged as new for them by design.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';

test.describe('Release notes', () => {
  test('renders the notes bundled from release-notes/', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/release-notes');

    await expect(page.getByRole('heading', { level: 1, name: /What.s New/ })).toBeVisible();
    expect(page.url()).toContain('/app/release-notes');

    const release = page.getByRole('article').first();

    // Frontmatter becomes the release heading and the dateline — and is never
    // shown as raw `key: value` text.
    await expect(release.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(release.getByText(/^Version \d+\.\d+\.\d+ · /)).toBeVisible();
    await expect(page.getByText('version:', { exact: false })).toHaveCount(0);
    await expect(page.getByText('---', { exact: true })).toHaveCount(0);
  });

  test('nests a note’s own sections under its release title', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/release-notes');
    await expect(page.getByRole('heading', { level: 1, name: /What.s New/ })).toBeVisible();

    const release = page.getByRole('article').first();

    // Exactly one h2 per release — the title. A `##` written in the note body
    // is demoted to h3, so sections belong to their release instead of reading
    // as siblings of the next one.
    await expect(release.getByRole('heading', { level: 2 })).toHaveCount(1);
    expect(await release.getByRole('heading', { level: 3 }).count()).toBeGreaterThan(0);
  });

  test('is reachable from the account menu', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: /What.s New/ }).click();

    await expect(page).toHaveURL(/\/app\/release-notes/);
  });
});

test.describe('Release notes — public', () => {
  test('reads without an account', async ({ page }) => {
    // No loginAs: the whole point is that a visitor deciding whether to sign up
    // can read this. A redirect to the login screen is the failure this catches.
    await page.goto('/release-notes');

    await expect(page).toHaveURL(/\/release-notes$/);
    await expect(page.getByRole('heading', { level: 1, name: /What.s New/ })).toBeVisible();
    expect(await page.getByRole('article').count()).toBeGreaterThan(0);
    await expect(
      page.getByRole('article').first().getByRole('heading', { level: 2 }),
    ).toBeVisible();
  });

  test('is reachable from the landing page', async ({ page }) => {
    await page.goto('/');

    await page
      .getByRole('navigation', { name: 'Site navigation' })
      .getByRole('link', { name: /What.s New/ })
      .click();

    await expect(page).toHaveURL(/\/release-notes$/);
    await expect(page.getByRole('heading', { level: 1, name: /What.s New/ })).toBeVisible();
  });

  test('offers a way back and a way in', async ({ page }) => {
    await page.goto('/release-notes');

    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/app');
    await page.getByRole('link', { name: /Back to home/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
