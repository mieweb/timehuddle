/**
 * Huddle — switching the edit target between two messages
 *
 * Regression guard carried over from the card view's "Edit post" composer,
 * whose uncontrolled editor once kept the first post's text when a second
 * post was opened for editing. Posts are now edited inline in the inbox
 * thread; this pins the same promise there: each edit box opens seeded with
 * its own message's text, never a previous target's.
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { editInboxMessage, inboxMessage, openPostInInbox, seedPost } from './helpers';

test.describe('Huddle — inline edit seeds from the message being edited', () => {
  test.slow();

  test('switching the edit target between two posts seeds the correct text each time', async ({
    page,
  }) => {
    const stamp = Date.now();
    const postAText = `edit-remount-a-${stamp}`;
    const postBText = `edit-remount-b-${stamp}`;

    await loginAs(page, TEST_USERS.member1);
    const teamId = await selectSharedTestTeam(page);
    // Same author, same day, no clock session — both land in one conversation.
    await seedPost(page, { teamId, text: postAText });
    await seedPost(page, { teamId, text: postBText });

    // Both posts contain the shared stamp, so this opens their conversation.
    await openPostInInbox(page, String(stamp));
    const editBox = page.getByRole('textbox', { name: 'Edit message' });

    await editInboxMessage(page, inboxMessage(page, postAText));
    await expect(editBox).toHaveValue(new RegExp(postAText));

    // Cancel without saving, then immediately edit post B.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editInboxMessage(page, inboxMessage(page, postBText));
    await expect(editBox).toHaveValue(new RegExp(postBText));
    await expect(editBox).not.toHaveValue(new RegExp(postAText));

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
});
