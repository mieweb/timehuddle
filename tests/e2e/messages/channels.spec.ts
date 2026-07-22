/**
 * Channels E2E Tests
 *
 * 1. Create, edit, and delete a channel from the Messages page
 * 2. The default #general channel cannot be deleted
 * 3. A channel message notifies other team members and the notification
 *    deep-links to the exact channel on click
 */
import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

async function getTeamId(code: string): Promise<string | null> {
  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();
  const team = await db.collection('teams').findOne({ code });
  await client.close();
  return team ? String(team._id) : null;
}

/** Remove any e2e-created channels (and their messages) for the test team. */
async function cleanupTestChannels(teamId: string): Promise<void> {
  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();
  const testChannels = await db
    .collection('channels')
    .find({ teamId, name: { $regex: /^e2e-/i } })
    .toArray();
  const channelIds = testChannels.map((c) => String(c._id));
  if (channelIds.length > 0) {
    await db.collection('channelmessages').deleteMany({ channelId: { $in: channelIds } });
    await db.collection('channels').deleteMany({ _id: { $in: testChannels.map((c) => c._id) } });
  }
  await client.close();
}

/** Select the Test Team Alpha on the Messages page via localStorage + reload. */
async function selectTestTeam(page: Page): Promise<string | null> {
  const teamId = await getTeamId('TEST01');
  if (!teamId) return null;

  await page.evaluate((id) => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('app:selectedTeamId'))
      .forEach((k) => localStorage.setItem(k, id));
    localStorage.setItem('app:selectedTeamId', id);
  }, teamId);
  await page.reload();
  await page.getByRole('heading', { level: 1, name: 'Messages' }).waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  return teamId;
}

async function createChannel(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create channel' }).click();
  await page.getByLabel('Channel name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByPlaceholder(`Message #${name}`)).toBeVisible({ timeout: 10000 });
}

let fixtureTeamId: string | null = null;

test.describe('Channels — create, edit, delete', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/messages');
    await page.getByRole('heading', { level: 1, name: 'Messages' }).waitFor({ state: 'visible' });
    fixtureTeamId = await selectTestTeam(page);
    test.skip(!fixtureTeamId, 'Test Team Alpha (TEST01) not found in DB');
  });

  test.afterEach(async () => {
    if (fixtureTeamId) await cleanupTestChannels(fixtureTeamId);
  });

  test('creates a new channel and selects it', async ({ page }) => {
    const channelName = `e2e-create-${Date.now()}`;
    await createChannel(page, channelName);

    await expect(
      page.getByRole('button', { name: `Channel ${channelName}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(`Message #${channelName}`)).toBeVisible();
  });

  test('edits a channel name and description', async ({ page }) => {
    const channelName = `e2e-edit-${Date.now()}`;
    await createChannel(page, channelName);

    const renamed = `${channelName}-renamed`;
    await page.getByRole('button', { name: `Edit channel ${channelName}` }).click();
    await page.getByRole('heading', { name: 'Edit Channel' }).waitFor({ state: 'visible' });
    await page.getByLabel('Channel name').fill(renamed);
    await page.getByLabel('Description (optional)').fill('Updated by e2e test');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByPlaceholder(`Message #${renamed}`)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Updated by e2e test')).toBeVisible();
  });

  test('deletes a non-default channel', async ({ page }) => {
    const channelName = `e2e-delete-${Date.now()}`;
    await createChannel(page, channelName);

    await page.getByRole('button', { name: `Edit channel ${channelName}` }).click();
    await page.getByRole('button', { name: 'Delete channel' }).click();
    await page.getByRole('heading', { name: `Delete #${channelName}?` }).waitFor({
      state: 'visible',
    });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByRole('button', { name: `Channel ${channelName}` })).toHaveCount(0, {
      timeout: 10000,
    });
    // Falls back to the default channel.
    await expect(page.getByPlaceholder('Message #general')).toBeVisible();
  });

  test('does not allow deleting the default #general channel', async ({ page }) => {
    await page.getByRole('button', { name: 'Channel general', exact: true }).click();
    await page.getByRole('button', { name: 'Edit channel general' }).click();
    await page.getByRole('heading', { name: 'Edit Channel' }).waitFor({ state: 'visible' });

    await expect(page.getByRole('button', { name: 'Delete channel' })).toHaveCount(0);
    await expect(page.getByText('The default channel cannot be renamed.')).toBeVisible();
  });
});

test.describe('Channel message notifications', () => {
  test('notifies other team members and deep-links to the exact channel on click', async ({
    browser,
  }) => {
    const teamId = await getTeamId('TEST01');
    test.skip(!teamId, 'Test Team Alpha (TEST01) not found in DB');

    const adminContext = await browser.newContext();
    const memberContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const memberPage = await memberContext.newPage();

    try {
      await loginAs(adminPage, TEST_USERS.owner1);
      await adminPage.goto('/app/messages');
      await adminPage
        .getByRole('heading', { level: 1, name: 'Messages' })
        .waitFor({ state: 'visible' });
      await selectTestTeam(adminPage);

      const channelName = `e2e-notif-${Date.now()}`;
      await createChannel(adminPage, channelName);

      const messageText = `Hello team, e2e ping ${Date.now()}`;
      await adminPage.getByPlaceholder(`Message #${channelName}`).fill(messageText);
      await adminPage.getByRole('button', { name: 'Send message' }).click();
      await expect(adminPage.getByText(messageText)).toBeVisible();

      // Member checks the Notifications inbox for the channel-message notification.
      await loginAs(memberPage, TEST_USERS.member1);
      await memberPage.goto('/app/notifications');
      await memberPage
        .getByRole('heading', { level: 1, name: /Notifications/i })
        .waitFor({ state: 'visible' });

      const notifRow = memberPage
        .getByRole('button')
        .filter({ hasText: `#${channelName}` })
        .first();
      await expect(notifRow).toBeVisible({ timeout: 15000 });
      await notifRow.click();

      // Clicking the notification should land on Messages with the exact
      // channel selected (openTeam/openChannel deep-link), not just the default.
      await expect(memberPage).toHaveURL(/\/app\/messages/, { timeout: 10000 });
      await expect(memberPage.getByPlaceholder(`Message #${channelName}`)).toBeVisible({
        timeout: 10000,
      });

      if (teamId) await cleanupTestChannels(teamId);
    } finally {
      await adminContext.close();
      await memberContext.close();
    }
  });
});
