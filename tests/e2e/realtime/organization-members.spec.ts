/**
 * Real-time organization member synchronization.
 *
 * `OrganizationMembersPage` subscribes to `orgMembers.byOrg` and refetches on
 * every `org_members` change, so a membership change made by one admin must
 * reach another admin's open page without a reload. That is the only thing
 * worth asserting here — two sessions rendering the same unchanged table,
 * which is what this file used to do, proves nothing.
 *
 * A role change is the mutation under test, because it is the only one this
 * page offers that actually writes the published collection:
 *   - Block/unblock and Reports To write onto `users`, which nothing here
 *     subscribes to, so the observing session stays stale until reload.
 *     `organizations/member-blocking-full-flow.spec.ts` covers blocking within
 *     a single session.
 *   - Remove does write `org_members`, but the row survives it: `loadOrgMembers`
 *     unions org membership with every team member in the org, and the seeded
 *     members are all on TEST01.
 *
 * Teardown restores the role directly in Mongo rather than through the UI,
 * because a demotion cannot be made through the UI at all: `orgs.setMemberRole`
 * delegates to `addOrgMember`, which keeps the *higher* of the old and new
 * roles (meteor-backend/server/org-helpers.js:136). Without the direct write
 * the promotion would leak into every later spec in this serial suite.
 */
import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { TEST_USERS, loginAs } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

/** A seeded member neither session is signed in as. */
const TARGET = TEST_USERS.member2;

/**
 * The org members table.
 *
 * It carries no accessible name, so it is identified by a column only it has.
 * A bare `table` locator is wrong here: `TicketsPage` stays mounted on every
 * route, so the first `<table>` on this page is its hidden "Open tickets" one
 * whenever a ticket spec ran earlier in this serial suite.
 */
const membersTable = (page: Page) =>
  page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Reports To' }) });

const memberRow = (page: Page, name: string) =>
  membersTable(page).locator('tbody tr').filter({ hasText: name });

/**
 * The role Select in a member's row.
 *
 * Scoped through the row rather than by `Set role for <name>`: the component's
 * `label="Role"` prop wins over the `aria-label` it is also given, so every
 * row's select is announced simply as "Role".
 */
const roleSelect = (page: Page, name: string) =>
  memberRow(page, name).getByRole('combobox', { name: 'Role' });

/** @mieweb/ui's Select is a combobox + listbox, not a native <select>. */
async function setRole(page: Page, name: string, label: 'Owner' | 'Admin' | 'Member') {
  await roleSelect(page, name).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

/** Undo a promotion at the database, for the reason in the file header. */
async function restoreMemberRole(email: string): Promise<void> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const db = client.db();
    const user = await db.collection('users').findOne({ 'emails.address': email });
    if (!user) return;
    const userId = String(user._id);
    await db
      .collection('org_members')
      .updateMany({ userId }, { $set: { role: 'member', updatedAt: new Date() } });
    await db
      .collection('organizations')
      .updateMany({}, { $pull: { owners: userId, admins: userId } });
  } finally {
    await client.close();
  }
}

async function waitForMembersPageReady(page: Page): Promise<void> {
  await page.goto('/app/org/members');
  const noOrg = page.getByText(/No organization is selected/i);
  if (await noOrg.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(noOrg).toBeHidden({ timeout: 30000 });
  }
  await expect(membersTable(page)).toBeVisible({ timeout: 20000 });
}

test.describe('Real-time Organization Members', () => {
  let session1: Page;
  let session2: Page;

  test.beforeEach(async ({ browser }) => {
    await restoreMemberRole(TARGET.email);

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    await loginAs(session1, TEST_USERS.owner1);
    await loginAs(session2, TEST_USERS.admin2);

    await waitForMembersPageReady(session1);
    await waitForMembersPageReady(session2);

    await expect(roleSelect(session1, TARGET.name)).toHaveText('Member');
    await expect(roleSelect(session2, TARGET.name)).toHaveText('Member');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
    await restoreMemberRole(TARGET.email);
  });

  test('a role change by one admin reaches the other without a reload', async () => {
    await setRole(session1, TARGET.name, 'Admin');

    await expect(roleSelect(session1, TARGET.name)).toHaveText('Admin', { timeout: 10000 });
    await expect(roleSelect(session2, TARGET.name)).toHaveText('Admin', { timeout: 10000 });
  });

  test('only the changed member updates in the observing session', async () => {
    const bystander = TEST_USERS.member3;
    await expect(roleSelect(session2, bystander.name)).toHaveText('Member');

    await setRole(session1, TARGET.name, 'Admin');
    await expect(roleSelect(session2, TARGET.name)).toHaveText('Admin', { timeout: 10000 });

    await expect(roleSelect(session2, bystander.name)).toHaveText('Member');
  });

  test('the observing session keeps the change after its own reload', async () => {
    // Guards the case where the live update is cosmetic — a client-side patch
    // that never reached the server would vanish on the next fetch.
    await setRole(session1, TARGET.name, 'Admin');
    await expect(roleSelect(session2, TARGET.name)).toHaveText('Admin', { timeout: 10000 });

    await waitForMembersPageReady(session2);

    await expect(roleSelect(session2, TARGET.name)).toHaveText('Admin', { timeout: 10000 });
  });
});
