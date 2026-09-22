/**
 * The "Me" option in the Assignees column filter (plan area f).
 *
 * "Me" is not one value: assignee ids are namespaced by source
 * (`huddle:<userId>`, `redmine:<accountId>`) because the two id spaces are
 * unrelated and can collide. The filter resolves a `ME` sentinel against that
 * set, so the cases worth an e2e pass are the ones a unit test cannot see —
 * that the set is wired to the signed-in session, and that it widens to
 * include Redmine once the link resolves.
 *
 * Two things shape every test here:
 *   - **The creator is auto-assigned** (meteor-backend/server/tickets.js:140),
 *     so a ticket that must *not* be mine has to have me explicitly removed.
 *     Otherwise "Me" matches everything and the spec proves nothing.
 *   - Assignees are limited to team members, so these run on the shared seed
 *     team TEST01 rather than the personal team, which has one member.
 *
 * Huddle tickets are real. Redmine is stubbed (see `fixtures/redmine.ts`).
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { TicketsPage } from '../pages/TicketsPage';
import { BASE_URL, connectedStatus, redmineIssue, stubRedmine } from '../fixtures/redmine';

/** The signed-in user for every test here. */
const ME = TEST_USERS.owner1;
const OTHER = TEST_USERS.member1;

async function openTickets(page: Page): Promise<TicketsPage> {
  await selectSharedTestTeam(page);
  const tickets = new TicketsPage(page);
  await tickets.goto();
  return tickets;
}

/**
 * Creates a Huddle ticket.
 *
 * With Redmine linked, "New Ticket" becomes a dropdown asking which system the
 * item belongs to, so the plain `TicketsPage.createTicket` path only works
 * while unlinked.
 */
async function createHuddleTicket(
  page: Page,
  title: string,
  { redmineLinked = false } = {},
): Promise<void> {
  await page.getByRole('button', { name: 'New Ticket' }).click();
  if (redmineLinked) {
    await page.getByText('TimeHuddle ticket', { exact: true }).click();
  }
  await page.getByPlaceholder('Ticket title').fill(title);
  await page.getByRole('button', { name: 'Create Ticket' }).click();
  await expect(page.getByPlaceholder('Ticket title')).toBeHidden({ timeout: 15000 });
}

/**
 * Sets a ticket's assignees to exactly `names`, clearing whatever was there.
 *
 * Assignees are a list of checkboxes, one per team member — not a Select — and
 * each takes its accessible name from the `<label>` wrapping it.
 */
async function setAssignees(
  page: Page,
  tickets: TicketsPage,
  title: string,
  names: string[],
): Promise<void> {
  await tickets.rowByTitle(title).getByRole('button', { name: 'Ticket options' }).click();
  await page.getByRole('menuitem', { name: 'Edit Ticket' }).click();
  const modal = page.getByRole('dialog');
  const boxes = modal.getByRole('checkbox');
  await expect(boxes.first()).toBeVisible({ timeout: 15000 });

  for (const box of await boxes.all()) {
    const name =
      (await box.getAttribute('aria-label')) ??
      (await box.evaluate((el) => el.closest('label')?.textContent?.trim() ?? ''));
    if (names.includes(name)) await box.check();
    else await box.uncheck();
  }

  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal).toBeHidden({ timeout: 15000 });
}

test.describe('Tickets — the "Me" assignee filter', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ME);
  });

  test('offers Me above the named assignees', async ({ page }) => {
    await stubRedmine(page, {});
    const tickets = await openTickets(page);
    await createHuddleTicket(page, `Filter option ${Date.now()}`);

    await tickets.filterTrigger('Assignees').click();

    await expect(page.getByRole('menuitem', { name: 'Me', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Unassigned', exact: true })).toBeVisible();
  });

  test('narrows to the signed-in user’s own tickets', async ({ page }) => {
    await stubRedmine(page, {});
    const tickets = await openTickets(page);

    const mine = `Mine ${Date.now()}`;
    const theirs = `Theirs ${Date.now()}`;
    await createHuddleTicket(page, mine);
    await createHuddleTicket(page, theirs);
    await setAssignees(page, tickets, theirs, [OTHER.name]);

    await tickets.filterBy('Assignees', 'Me');

    await expect(tickets.rowByTitle(mine)).toHaveCount(1);
    await expect(tickets.rowByTitle(theirs)).toHaveCount(0);
  });

  test('excludes a ticket I was removed from', async ({ page }) => {
    await stubRedmine(page, {});
    const tickets = await openTickets(page);

    const title = `Handed over ${Date.now()}`;
    await createHuddleTicket(page, title);
    await tickets.filterBy('Assignees', 'Me');
    await expect(tickets.rowByTitle(title)).toHaveCount(1);

    await tickets.clearFiltersButton.click();
    await setAssignees(page, tickets, title, [OTHER.name]);
    await tickets.filterBy('Assignees', 'Me');

    await expect(tickets.rowByTitle(title)).toHaveCount(0);
  });

  test('matches Redmine issues assigned to the linked account too', async ({ page }) => {
    await stubRedmine(page, {
      status: connectedStatus({ redmineUserId: 8 }),
      'issues.list': {
        connected: true,
        baseUrl: BASE_URL,
        issues: [
          // Not named "Me": the filter menu already has a "Me" sentinel entry,
          // and an assignee by that name would collide with it.
          redmineIssue({
            id: 15,
            subject: 'Mine in Redmine',
            assignedTo: { id: 8, name: 'Linked Redmine User' },
          }),
          redmineIssue({
            id: 23,
            subject: 'Someone else in Redmine',
            assignedTo: { id: 42, name: 'Other Person' },
          }),
        ],
      },
    });
    const tickets = await openTickets(page);

    const mine = `Mine huddle ${Date.now()}`;
    await createHuddleTicket(page, mine, { redmineLinked: true });

    await tickets.filterBy('Assignees', 'Me');

    // Both namespaces at once — the whole point of the sentinel.
    await expect(tickets.rowByTitle('Mine in Redmine')).toHaveCount(1);
    await expect(tickets.rowByTitle(mine)).toHaveCount(1);
    await expect(tickets.rowByTitle('Someone else in Redmine')).toHaveCount(0);
  });

  test('a Huddle id never matches a Redmine account with the same number', async ({ page }) => {
    // The ids are unrelated integers in different spaces; without the
    // `source:id` namespacing, a Redmine assignee could match a Huddle user
    // that merely shares its number.
    await stubRedmine(page, {
      status: connectedStatus({ redmineUserId: 999999 }),
      'issues.list': {
        connected: true,
        baseUrl: BASE_URL,
        issues: [
          redmineIssue({
            id: 31,
            subject: 'Assigned to a colliding id',
            assignedTo: { id: 8, name: 'Not me' },
          }),
        ],
      },
    });
    const tickets = await openTickets(page);
    await createHuddleTicket(page, `Anchor ${Date.now()}`, { redmineLinked: true });

    await tickets.filterBy('Assignees', 'Me');

    await expect(tickets.rowByTitle('Assigned to a colliding id')).toHaveCount(0);
  });

  test('still filters Huddle rows when no Redmine account is linked', async ({ page }) => {
    await stubRedmine(page, { status: { connected: false } });
    const tickets = await openTickets(page);

    const mine = `Unlinked mine ${Date.now()}`;
    const theirs = `Unlinked theirs ${Date.now()}`;
    await createHuddleTicket(page, mine);
    await createHuddleTicket(page, theirs);
    await setAssignees(page, tickets, theirs, [OTHER.name]);

    await tickets.filterBy('Assignees', 'Me');

    await expect(tickets.rowByTitle(mine)).toHaveCount(1);
    await expect(tickets.rowByTitle(theirs)).toHaveCount(0);
  });

  test('clearing the filter brings everyone back', async ({ page }) => {
    await stubRedmine(page, {});
    const tickets = await openTickets(page);

    const mine = `Clear mine ${Date.now()}`;
    const theirs = `Clear theirs ${Date.now()}`;
    await createHuddleTicket(page, mine);
    await createHuddleTicket(page, theirs);
    await setAssignees(page, tickets, theirs, [OTHER.name]);

    await tickets.filterBy('Assignees', 'Me');
    await expect(tickets.rowByTitle(theirs)).toHaveCount(0);

    await tickets.clearFiltersButton.click();

    await expect(tickets.rowByTitle(theirs)).toHaveCount(1);
  });
});
