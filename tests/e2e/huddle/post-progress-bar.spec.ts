/**
 * Huddle — Post Progress Bar
 *
 * Verifies that submitting a text post shows the progress bar
 * (`data-testid="post-progress-bar"`) while the request is in flight and
 * that the post appears in the feed once the bar completes.
 *
 * Also covers the "Posting…" disabled-button state so double-submits can't
 * happen.
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { composerEditor, openComposer, postContainer, switchToCardView } from './helpers';

test.describe('Huddle — post progress bar', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
  });

  test('progress bar appears while posting and disappears after post lands in feed', async ({
    page,
  }) => {
    const postText = `Progress bar test ${Date.now()}`;

    await composerEditor(page).fill(postText);

    // Race: watch for the progress bar the instant Post is clicked so we
    // don't miss its brief appearance on a fast local backend.
    const progressBar = page.locator('[data-testid="post-progress-bar"]');
    const progressVisible = progressBar.waitFor({ state: 'visible', timeout: 5000 });

    await page.getByRole('button', { name: 'Post', exact: true }).click();

    // Progress bar must appear
    await progressVisible;
    await expect(progressBar).toBeVisible();

    // Button must be disabled and show "Posting…" while in flight
    const postBtn = page.getByRole('button', { name: 'Posting…', exact: true });
    await expect(postBtn).toBeDisabled();

    // Progress bar disappears once the post resolves
    await progressBar.waitFor({ state: 'hidden', timeout: 15000 });

    // Post must appear in the feed
    await switchToCardView(page);
    await expect(postContainer(page, postText)).toBeVisible({ timeout: 10000 });
  });

  test('Post button is disabled while posting to prevent double-submit', async ({ page }) => {
    const postText = `Double-submit guard ${Date.now()}`;

    await composerEditor(page).fill(postText);

    const postBtn = page.getByRole('button', { name: 'Post', exact: true });
    await expect(postBtn).toBeEnabled();

    // Click and immediately assert the button is disabled
    const disabledPromise = expect(
      page.getByRole('button', { name: 'Posting…', exact: true }),
    ).toBeDisabled();

    await postBtn.click();
    await disabledPromise;

    // Wait for completion
    await page.locator('[data-testid="post-progress-bar"]').waitFor({
      state: 'hidden',
      timeout: 15000,
    });
  });
});
