/**
 * Huddle — editing a post works end to end.
 *
 * The old card view's edit composer was the only place that asked RichEditor
 * for live co-editing, and RichEditor builds that kit behind a dynamic
 * `import()`. When the chunk failed to load, RichEditor swallowed the error and
 * rendered nothing, so the post could not be edited.
 *
 * Posts are now edited inline in the inbox thread (a plain text box), so this
 * asserts that editing your own message saves what you type — and that editing
 * never reaches for the collaborative chunk, which stays off until the
 * component survives that failure (see `src/features/huddle/collab.ts` and
 * mieweb/ui#480).
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { editInboxMessage, inboxMessage, openPostInInbox, seedPost } from './helpers';

test.describe('Huddle — editing a post', () => {
  test.slow();

  test('opens an editor seeded with the post, and saves what you type', async ({ page }) => {
    const seed = `edit-post-${Date.now()}`;
    const appended = ' — edited';

    // Every request for the collaborative kit, so the test fails if editing
    // starts asking for it again while it is meant to be off.
    const collabChunkRequests: string[] = [];
    page.on('request', (request) => {
      if (/collabKit/.test(request.url())) collabChunkRequests.push(request.url());
    });

    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    await seedPost(page, { teamId, text: seed });

    await editInboxMessage(page, await openPostInInbox(page, seed));

    const editor = page.getByRole('textbox', { name: 'Edit message' });
    await expect(editor).toHaveValue(seed);

    await editor.press('End');
    await editor.pressSequentially(appended);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(inboxMessage(page, seed + appended)).toBeVisible({ timeout: 15000 });
    expect(collabChunkRequests).toEqual([]);
  });
});
