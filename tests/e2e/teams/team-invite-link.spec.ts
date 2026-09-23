/**
 * Team Invite Link E2E Tests
 *
 * Covers sharing a team from the Teams page, where two things are on offer and
 * they grant different access:
 *
 *   1. An admin generates an invite link → QR + URL carrying an opaque token,
 *      shown once, never the team code.
 *   2. A signed-in user opens the link → joins immediately. (This is the case
 *      that used to fail silently: AppLayout resolves `/app` to
 *      `/app/dashboard` during render and dropped the query string with it,
 *      so nothing ever read `?join=`.)
 *   3. A signed-out visitor opens the link → sees which team they're joining,
 *      signs in, and is added.
 *   4. A team-code link only *requests* membership — the code names a team,
 *      it is not an invitation.
 *   5. A revoked link grants nothing and says so.
 *
 * Uses the isolated `timehuddle_test` DB (see global-setup.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

const STAMP = Date.now();
const TEAM_NAME = `Invite Link Team ${STAMP}`;
// Team codes are 8 Crockford base32 characters; keep the same shape.
const TEAM_CODE = `IL${STAMP.toString(32).toUpperCase().slice(-6)}`;

/** Select the shared test team via the org/team switcher (deep links are racy). */
async function selectTeam(page: Page, teamName: string) {
  await page.getByRole('button', { name: /Switch organization and team/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: teamName }).click();
}

/** Open the Teams page with the test team selected. */
async function openTeamsPage(page: Page) {
  await page.goto('/app/teams');
  await expect(page.getByRole('button', { name: 'Create Team' })).toBeVisible({ timeout: 30000 });
  await selectTeam(page, TEAM_NAME);
  await expect(page.getByText(TEAM_CODE)).toBeVisible({ timeout: 15000 });
}

/** Generate a fresh invite link as an admin and return its URL. */
async function generateInviteLink(page: Page): Promise<string> {
  await openTeamsPage(page);
  await page.getByRole('button', { name: 'Share team invite link' }).click();

  const dialog = page.getByRole('dialog').filter({ hasText: 'Share Team' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Generate (invite link|new link)/ }).click();

  await expect(dialog.getByTestId('team-invite-link-status')).toContainText(/shown this once/i, {
    timeout: 15000,
  });
  const url = (await dialog.getByTestId('team-share-link').textContent())!.trim();
  return url;
}

test.describe('Team Invite Link', () => {
  const admin = TEST_USERS.admin1;
  let mongoClient: MongoClient;
  let db: Db;
  let teamId: ObjectId;
  let orgId: string;
  let adminId: string;

  /** Detach a user so each redemption test starts from "not a member". */
  async function detach(email: string) {
    const user = await db.collection('users').findOne({ 'emails.address': email });
    if (!user) return;
    const userId = String(user._id);
    await db
      .collection('teams')
      .updateOne({ _id: teamId as never }, { $pull: { members: userId } } as never);
    await db.collection('teamjoinrequests').deleteMany({ teamId: teamId.toHexString(), userId });
  }

  async function isMember(email: string): Promise<boolean> {
    const user = await db.collection('users').findOne({ 'emails.address': email });
    if (!user) return false;
    const team = await db.collection('teams').findOne({ _id: teamId as never });
    return team?.members?.includes(String(user._id)) ?? false;
  }

  test.beforeAll(async () => {
    mongoClient = await MongoClient.connect(MONGO_URL);
    db = mongoClient.db();

    const defaultOrg = await db.collection('organizations').findOne({ slug: 'default' });
    expect(defaultOrg).toBeTruthy();
    orgId = defaultOrg!._id.toHexString();

    const adminUser = await db.collection('users').findOne({ 'emails.address': admin.email });
    expect(adminUser).toBeTruthy();
    adminId = String(adminUser!._id);

    teamId = new ObjectId();
    await db.collection('teams').insertOne({
      _id: teamId as never,
      orgId,
      parentTeamId: null,
      name: TEAM_NAME,
      members: [adminId],
      admins: [adminId],
      code: TEAM_CODE,
      isPersonal: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test.afterAll(async () => {
    await db.collection('teams').deleteOne({ _id: teamId as never });
    await db.collection('team_invitations').deleteMany({ teamId: teamId.toHexString() });
    await db.collection('teamjoinrequests').deleteMany({ teamId: teamId.toHexString() });
    await mongoClient?.close();
  });

  test('admin generates a link carrying an opaque token, not the team code', async ({ page }) => {
    await loginAs(page, admin);
    const url = await generateInviteLink(page);

    const token = new URL(url).searchParams.get('join');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(url).not.toContain(TEAM_CODE);

    const dialog = page.getByRole('dialog').filter({ hasText: 'Share Team' });
    await expect(dialog.getByTestId('team-share-qr')).toBeVisible();
    // Copy sits inside the invite-link section, so it can only mean that URL.
    await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Copied!' })).toBeVisible();

    // While the URL is on screen there is no "generate a replacement" button —
    // it would only discard the link the admin is reading.
    await expect(dialog.getByRole('button', { name: /Generate/ })).toHaveCount(0);

    // Only the hash is persisted — the token must not be in the database.
    const stored = await db
      .collection('team_invitations')
      .findOne({ teamId: teamId.toHexString(), kind: 'link', status: 'pending' });
    expect(stored).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  test('a signed-in user opening the link joins straight away', async ({ browser }) => {
    test.setTimeout(90000);
    const joiner = TEST_USERS.member2;
    await detach(joiner.email);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    let url: string;
    try {
      await loginAs(adminPage, admin);
      url = await generateInviteLink(adminPage);
    } finally {
      await adminContext.close();
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // Already signed in *before* the link is opened — the case that silently
      // did nothing until the params were captured before AppLayout's rewrite.
      await loginAs(page, joiner);
      await page.goto(url);

      await expect(page.getByRole('dialog').filter({ hasText: 'Team joined' })).toBeVisible({
        timeout: 30000,
      });
      await expect.poll(() => isMember(joiner.email), { timeout: 15000 }).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('a signed-out visitor is told which team, then joins after signing in', async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const joiner = TEST_USERS.member3;
    await detach(joiner.email);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    let url: string;
    try {
      await loginAs(adminPage, admin);
      url = await generateInviteLink(adminPage);
    } finally {
      await adminContext.close();
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(url);
      await expect(page.getByText(`You're joining the team ${TEAM_NAME}`)).toBeVisible({
        timeout: 20000,
      });

      // The link opens in signup mode — it is written for people without an
      // account — so an existing user switches to sign-in first. Until that
      // click, "Sign in" is the mode-switch link, not the submit button.
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.fill('input[type="email"]', joiner.email);
      await page.fill('input[type="password"]', joiner.password);
      await page.click('button:has-text("Sign in")');

      // Redeeming a link always lands on Teams saying what it did, whether the
      // visitor was already signed in or has just signed in.
      await expect(page.getByRole('dialog').filter({ hasText: 'Team joined' })).toBeVisible({
        timeout: 45000,
      });
      await expect.poll(() => isMember(joiner.email), { timeout: 15000 }).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('a team-code link asks to join rather than joining', async ({ browser }) => {
    test.setTimeout(90000);
    const joiner = TEST_USERS.member4;
    await detach(joiner.email);

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`/app?mode=signup&join=${TEAM_CODE}`);
      // The banner promises approval, not membership.
      await expect(page.getByText(/asking to join the team/i)).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(new RegExp(TEAM_NAME))).toBeVisible();

      // Signup mode — switch to sign-in, as the invite-link test does.
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.fill('input[type="email"]', joiner.email);
      await page.fill('input[type="password"]', joiner.password);
      await page.click('button:has-text("Sign in")');

      // Not "Team joined" — a code only ever asks.
      await expect(page.getByRole('dialog').filter({ hasText: 'Request sent' })).toBeVisible({
        timeout: 45000,
      });

      const user = await db.collection('users').findOne({ 'emails.address': joiner.email });
      await expect
        .poll(
          async () =>
            await db.collection('teamjoinrequests').countDocuments({
              teamId: teamId.toHexString(),
              userId: String(user!._id),
              status: 'pending',
            }),
          { timeout: 15000 },
        )
        .toBe(1);
      expect(await isMember(joiner.email)).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('a revoked link grants nothing and says so', async ({ browser }) => {
    test.setTimeout(90000);
    const joiner = TEST_USERS.member5;
    await detach(joiner.email);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    let url: string;
    try {
      await loginAs(adminPage, admin);
      url = await generateInviteLink(adminPage);

      const dialog = adminPage.getByRole('dialog').filter({ hasText: 'Share Team' });
      await dialog.getByRole('button', { name: 'Revoke the active invite link' }).click();
      await expect(dialog.getByTestId('team-invite-link-status')).toContainText(
        /No invite link is active/i,
        { timeout: 15000 },
      );
    } finally {
      await adminContext.close();
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAs(page, joiner);
      await page.goto(url);

      const dialog = page.getByRole('dialog').filter({ hasText: 'This link did not work' });
      await expect(dialog).toBeVisible({ timeout: 30000 });
      await expect(dialog.getByText(/revoked/i)).toBeVisible();
      expect(await isMember(joiner.email)).toBe(false);
    } finally {
      await context.close();
    }
  });
});
