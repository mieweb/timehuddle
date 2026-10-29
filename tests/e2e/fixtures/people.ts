/**
 * People page helpers: the Members tab (org admins) on `/app/organization`.
 *
 * The roster is found by a column only it has, not a bare `table` locator:
 * TicketsPage stays mounted on every route, so its hidden table may come first.
 * Block, unblock, remove and view profile live in each row's "More actions" menu.
 */
import { expect, type Page } from '@playwright/test';

export const membersTable = (page: Page) =>
  page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Reports to' }) });

export const memberRow = (page: Page, name: string) =>
  membersTable(page).locator('tbody tr').filter({ hasText: name });

export async function openMembers(page: Page): Promise<void> {
  await page.goto('/app/organization?tab=members');
  await expect(page.getByText(/No organization is selected/i)).toBeHidden({ timeout: 30000 });
  await expect(membersTable(page)).toBeVisible({ timeout: 30000 });
}

export type MemberAction = 'View profile' | 'Block access' | 'Unblock' | 'Remove from organization';

/** The item in a member's row menu, with the menu opened. */
export async function memberAction(page: Page, name: string, action: MemberAction) {
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  return page.getByRole('menuitem', { name: action });
}

export async function openInvitations(page: Page): Promise<void> {
  await page.goto('/app/organization?tab=invitations');
  await expect(
    page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Expires' }) }),
  ).toBeVisible({ timeout: 30000 });
}

/** Sends an invite to `email` from the Invite by email dialog, opening it if needed. */
export async function inviteByEmail(page: Page, email: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible()))
    await page.getByRole('button', { name: 'Invite by email' }).click();
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Send Invite' }).click();
}
