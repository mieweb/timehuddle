/**
 * Organization Email Invitations E2E Tests
 *
 * Covers the "Invite by Email" flow on the Organization → Members page:
 *
 *   1. Owner invites a brand-new address → pending invite email is sent via
 *      Mailpit, the signup link pre-fills/locks the email and shows the
 *      "invited to join" banner, and completing signup flips the invitation
 *      from pending → accepted.
 *   2. Inviting the same pending email twice surfaces an
 *      "invitation already exists" error.
 *   3. Inviting an email that already belongs to a platform user joins them
 *      immediately with no invitation email sent.
 *   4. Revoking a pending invitation flips its status to revoked and the
 *      invite link then shows the "This invitation has been revoked" error.
 *   5. Org owners get "Team Settings" (gear) authority on teams they didn't
 *      create and aren't in `admins` for.
 *
 * Uses the isolated `timehuddle_test` DB (see global-setup.ts) so it never
 * touches dev data. Mailpit must be reachable at MAILPIT_URL (default
 * localhost:8025).
 */
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
const PASSWORD = 'InvitePass123!';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}
interface MailpitList {
  messages: MailpitMessage[];
}
interface MailpitDetail {
  Text?: string;
  HTML?: string;
}

async function waitForInviteLink(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as MailpitList;
    const match = list.messages.find((m) =>
      m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
    );
    if (match) {
      const detail = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`)
      ).json()) as MailpitDetail;
      const body = detail.Text ?? detail.HTML ?? '';
      const url = body.match(/https?:\/\/\S+org_invite=[^\s"<>]+/)?.[0];
      if (url) return url.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No invite email arrived for ${email} within ${timeoutMs}ms`);
}

async function hasMailFor(email: string): Promise<boolean> {
  const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as MailpitList;
  return list.messages.some((m) => m.To.some((t) => t.Address.toLowerCase() === email));
}

/** Navigate to Organization → Members and open the invite box. */
async function gotoMembers(page: Page) {
  await page.goto('/app/org/members');
  await expect(page.getByText(/No organization is selected/i)).toBeHidden({ timeout: 30000 });
  await expect(page.getByText('Loading members')).toBeHidden({ timeout: 30000 });
  await expect(page.getByLabel('Invite by Email')).toBeVisible({ timeout: 30000 });
}

async function sendInvite(page: Page, email: string) {
  await page.getByLabel('Invite by Email').fill(email);
  await page.getByRole('button', { name: 'Send Invite' }).click();
}

test.describe('Organization Email Invitations', () => {
  const owner = TEST_USERS.owner1;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, owner);
  });

  test('new address: pending invite → signup via link → status flips to accepted', async ({
    page,
    browser,
  }) => {
    test.setTimeout(60000);
    const email = `invitee-${Date.now()}@test.dev`;

    await gotoMembers(page);
    await sendInvite(page, email);

    await expect(page.getByText(`A secure account setup link was sent to ${email}.`)).toBeVisible({
      timeout: 20000,
    });

    // Pending Invitations modal shows the new invite as pending.
    await page.getByRole('button', { name: 'Pending Invitations' }).click();
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText('pending', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Fetch the invite link from Mailpit and open it in a fresh context.
    const inviteUrl = await waitForInviteLink(email);
    const invitedContext = await browser.newContext();
    const invitedPage = await invitedContext.newPage();
    try {
      await invitedPage.goto(inviteUrl);

      // Email is pre-filled and locked; banner explains the invite.
      const emailInput = invitedPage.getByRole('textbox', { name: 'Email address' });
      await expect(emailInput).toHaveValue(email, { timeout: 10000 });
      await expect(emailInput).toBeDisabled();
      await expect(invitedPage.getByText(/You were invited to join/i)).toBeVisible();

      const stamp = Date.now();
      await invitedPage.getByRole('textbox', { name: 'First name' }).fill('Invited');
      await invitedPage.getByRole('textbox', { name: 'Last name' }).fill(`Person${stamp}`);
      await invitedPage.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
      await invitedPage.getByRole('textbox', { name: 'Confirm password' }).fill(PASSWORD);
      await invitedPage.getByRole('button', { name: 'Create account', exact: true }).click();

      // New account may be prompted to claim a username before landing in the app.
      const usernameDialog = invitedPage.getByRole('dialog', { name: 'Username Required' });
      await Promise.race([
        invitedPage.waitForURL(/\/app\/(dashboard)?$/, { timeout: 20000 }).catch(() => {}),
        usernameDialog.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
      ]);
      if (await usernameDialog.isVisible().catch(() => false)) {
        // Use a unique username — the auto-suggested one may already be
        // claimed by a leftover account from a previous test run.
        const usernameInput = usernameDialog.getByRole('textbox', { name: 'Username' });
        await usernameInput.fill(`invited_${stamp}`);
        await usernameDialog.getByRole('button', { name: 'Claim username' }).click();
        await usernameDialog.waitFor({ state: 'hidden', timeout: 10000 });
      }
      await invitedPage.waitForURL(/\/app\/(dashboard)?$/, { timeout: 20000 });
    } finally {
      await invitedContext.close();
    }

    // Owner's Pending Invitations now shows the invite as accepted.
    await gotoMembers(page);
    await page.getByRole('button', { name: 'Pending Invitations' }).click();
    const acceptedRow = page.getByRole('row').filter({ hasText: email });
    await expect(acceptedRow.getByText('accepted', { exact: true })).toBeVisible({
      timeout: 15000,
    });
  });

  test('inviting the same pending email twice shows an "already exists" error', async ({
    page,
  }) => {
    const email = `dup-invitee-${Date.now()}@test.dev`;

    await gotoMembers(page);
    await sendInvite(page, email);
    await expect(page.getByText(`A secure account setup link was sent to ${email}.`)).toBeVisible({
      timeout: 20000,
    });

    await sendInvite(page, email);
    await expect(
      page.getByText(/pending invitation already exists for this email address/i),
    ).toBeVisible({ timeout: 10000 });
  });

  test('inviting an existing platform user joins them immediately without sending an email', async ({
    page,
  }) => {
    // Create a user who exists in the platform but is not yet a member of the
    // default organization, so `orgs.invite` takes the "existingUser" branch.
    const client = await MongoClient.connect(MONGO_URL);
    const db = client.db();
    const email = `existing-platform-user-${Date.now()}@test.dev`;
    const userId = new ObjectId().toHexString();
    try {
      await db.collection('users').insertOne({
        _id: userId,
        emails: [{ address: email, verified: true }],
        profile: { name: 'Existing Platform User' },
        createdAt: new Date(),
      });

      await gotoMembers(page);
      await sendInvite(page, email);

      // No "secure setup link" status message — the user joins right away.
      await expect(
        page.getByText(`A secure account setup link was sent to ${email}.`),
      ).toBeHidden();
      await expect(page.getByRole('cell', { name: email })).toBeVisible({ timeout: 15000 });

      const receivedEmail = await hasMailFor(email);
      expect(receivedEmail).toBe(false);
    } finally {
      await db.collection('org_members').deleteMany({ userId });
      await db.collection('users').deleteOne({ _id: userId });
      await client.close();
    }
  });

  test('revoking a pending invitation blocks the invite link', async ({ page, browser }) => {
    const email = `revoked-invitee-${Date.now()}@test.dev`;

    await gotoMembers(page);
    await sendInvite(page, email);
    await expect(page.getByText(`A secure account setup link was sent to ${email}.`)).toBeVisible({
      timeout: 20000,
    });

    const inviteUrl = await waitForInviteLink(email);

    await page.getByRole('button', { name: 'Pending Invitations' }).click();
    const row = page.getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: `Revoke invitation for ${email}` }).click();
    await expect(row.getByText('revoked', { exact: true })).toBeVisible({ timeout: 10000 });

    const revokedContext = await browser.newContext();
    const revokedPage = await revokedContext.newPage();
    try {
      await revokedPage.goto(inviteUrl);
      await expect(revokedPage.getByText(/this invitation has been revoked/i)).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await revokedContext.close();
    }
  });
});

test.describe('Org Owner Team Authority', () => {
  const owner = TEST_USERS.owner1;

  test('org owner sees Team Settings on a team they did not create and are not an admin of', async ({
    page,
  }) => {
    const client = await MongoClient.connect(MONGO_URL);
    const db = client.db();
    let teamId: ObjectId | undefined;
    try {
      const org = await db.collection('organizations').findOne({ slug: 'default' });
      expect(org).toBeTruthy();
      const orgId = org!._id.toHexString();

      const ownerUser = await db
        .collection('users')
        .findOne({ 'emails.address': owner.email }, { projection: { _id: 1 } });
      const adminUser = await db
        .collection('users')
        .findOne({ 'emails.address': TEST_USERS.admin2.email }, { projection: { _id: 1 } });
      expect(ownerUser).toBeTruthy();
      expect(adminUser).toBeTruthy();
      const ownerId = String(ownerUser!._id);
      const adminId = String(adminUser!._id);

      teamId = new ObjectId();
      const teamName = `Authority Test Team ${Date.now()}`;
      await db.collection('teams').insertOne({
        _id: teamId,
        name: teamName,
        code: `AUTH${Date.now().toString().slice(-6)}`,
        orgId,
        createdBy: adminId,
        members: [adminId, ownerId],
        admins: [adminId], // owner is deliberately NOT in admins
        isPersonal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await loginAs(page, owner);
      await page.goto('/app/teams');
      await page.waitForLoadState('networkidle');

      // Select the new team via the org/team switcher — more reliable than the
      // `?teamId=` deep link, which can race with the initial teams fetch.
      await page.getByRole('button', { name: /Switch organization and team/i }).click();
      await page.getByRole('menuitem', { name: teamName }).click();

      await expect(page.getByRole('heading', { name: teamName, level: 3 })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByRole('button', { name: 'Team Settings' })).toBeVisible({
        timeout: 15000,
      });
    } finally {
      if (teamId) await db.collection('teams').deleteOne({ _id: teamId });
      await client.close();
    }
  });
});
