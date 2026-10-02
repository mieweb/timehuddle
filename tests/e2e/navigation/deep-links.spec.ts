/**
 * Deep-link E2E tests (#618).
 *
 * The URL is the source of truth for the selected team: `?team=` wins over the
 * team remembered in localStorage, survives reload and sidebar navigation, and
 * a team the user can't access is never swapped for another one.
 * See src/ui/ROUTING.md.
 */
import { expect, test, type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';

import { getTeamIdByCode, selectSharedTestTeam } from '../fixtures/team';
import { createTicket, deleteTicket } from '../tickets/helpers';
import { TEST_USERS, loginAs } from '../fixtures/users';

/** A well-formed team id no user belongs to. */
const UNKNOWN_TEAM_ID = 'ffffffffffffffffffffffff';

const teamParam = (page: Page) => new URL(page.url()).searchParams.get('team');

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

/** Runs `fn` against the test DB's tickets collection. */
async function withTickets<T>(
  fn: (tickets: ReturnType<ReturnType<MongoClient['db']>['collection']>) => Promise<T>,
): Promise<T> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    return await fn(client.db().collection('tickets'));
  } finally {
    await client.close();
  }
}

const noAccessHeading = (page: Page, what: RegExp) =>
  page.getByRole('heading', { level: 1, name: what });

let sharedTeamId: string;

test.describe('Deep links: team scope', () => {
  test.setTimeout(60000);

  test.beforeAll(async () => {
    const id = await getTeamIdByCode('TEST01');
    if (!id) throw new Error('Shared seed team TEST01 not found — did global-setup run?');
    sharedTeamId = id;
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('stamps the selected team onto the URL', async ({ page }) => {
    await expect.poll(() => teamParam(page)).toBeTruthy();
  });

  test('?team= selects that team and survives a reload', async ({ page }) => {
    await page.goto(`/app/dashboard?team=${sharedTeamId}`);
    await expect(page.getByText('Test Team Alpha').first()).toBeVisible();

    await page.reload();
    await expect(page.getByText('Test Team Alpha').first()).toBeVisible();
    expect(teamParam(page)).toBe(sharedTeamId);
  });

  test('the legacy ?teamId= alias is normalised to ?team=', async ({ page }) => {
    await page.goto(`/app/dashboard?teamId=${sharedTeamId}`);
    await expect.poll(() => teamParam(page)).toBe(sharedTeamId);
    expect(new URL(page.url()).searchParams.has('teamId')).toBe(false);
  });

  test('sidebar navigation keeps the linked team', async ({ page }) => {
    await page.goto(`/app/dashboard?team=${sharedTeamId}`);
    await expect(page.getByText('Test Team Alpha').first()).toBeVisible();

    await page.locator('aside').getByRole('button', { name: 'Tickets', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/tickets\?/);
    expect(teamParam(page)).toBe(sharedTeamId);
  });

  test('a team the user is not in shows no access, never another team', async ({ page }) => {
    await page.goto(`/app/dashboard?team=${UNKNOWN_TEAM_ID}`);
    await expect(noAccessHeading(page, /have access to this team/)).toBeVisible();
    expect(teamParam(page)).toBe(UNKNOWN_TEAM_ID);

    await page.getByRole('button', { name: 'Go to dashboard' }).click();
    await expect(noAccessHeading(page, /have access to this team/)).toBeHidden();
    await expect.poll(() => teamParam(page)).not.toBe(UNKNOWN_TEAM_ID);
  });
});

test.describe('Deep links: team pages', () => {
  test.setTimeout(60000);

  test.beforeAll(async () => {
    const id = await getTeamIdByCode('TEST01');
    if (!id) throw new Error('Shared seed team TEST01 not found — did global-setup run?');
    sharedTeamId = id;
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('/app/teams redirects to the selected team’s page', async ({ page }) => {
    // Opening a team by link makes it the remembered team…
    await page.goto(`/app/dashboard?team=${sharedTeamId}`);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage)
            .filter((k) => k.startsWith('app:selectedTeamId:'))
            .map((k) => localStorage.getItem(k)),
        ),
      )
      .toEqual([sharedTeamId]);
    // …so a bare /app/teams lands on it.
    await page.goto('/app/teams');
    await expect(page).toHaveURL(new RegExp(`/app/teams/${sharedTeamId}$`));
  });

  test('/app/teams/:teamId opens that team and survives a reload', async ({ page }) => {
    await page.goto(`/app/teams/${sharedTeamId}`);
    await expect(
      page.locator('main').getByText('Test Team Alpha').filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.locator('aside').getByRole('button', { name: 'Teams', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    await page.reload();
    await expect(
      page.locator('main').getByText('Test Team Alpha').filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/app/teams/${sharedTeamId}$`));
  });

  test('a team page the user is not in shows no access', async ({ page }) => {
    await page.goto(`/app/teams/${UNKNOWN_TEAM_ID}`);
    await expect(noAccessHeading(page, /have access to this team/)).toBeVisible();
  });
});

test.describe('Deep links: ticket no-access and not-found', () => {
  test.setTimeout(60000);

  // A ticket in a team no test user belongs to.
  const foreignTicketId = new ObjectId();

  test.beforeAll(async () => {
    await withTickets((tickets) =>
      tickets.insertOne({
        _id: foreignTicketId,
        teamId: new ObjectId().toHexString(),
        title: 'Someone else’s ticket',
        status: 'open',
        createdBy: 'nobody',
        createdAt: new Date(),
      }),
    );
  });

  test.afterAll(async () => {
    await withTickets((tickets) => tickets.deleteOne({ _id: foreignTicketId }));
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('a ticket in another team shows no access', async ({ page }) => {
    await page.goto(`/app/tickets/${foreignTicketId.toHexString()}`);
    await expect(noAccessHeading(page, /have access to this ticket/)).toBeVisible();
  });

  test('a ticket that does not exist shows not found, not no access', async ({ page }) => {
    await page.goto(`/app/tickets/${new ObjectId().toHexString()}`);
    await expect(noAccessHeading(page, /ticket doesn.t exist or was deleted/)).toBeVisible();
    await expect(noAccessHeading(page, /have access/)).toBeHidden();
  });

  test('a malformed ticket id shows not found', async ({ page }) => {
    await page.goto('/app/tickets/not-a-ticket');
    await expect(noAccessHeading(page, /ticket doesn.t exist or was deleted/)).toBeVisible();
  });
});

test.describe('Deep links: tickets list', () => {
  test.setTimeout(90000);

  const title = `deep-link ticket ${Date.now()}`;
  const searchBox = (page: Page) => page.getByPlaceholder('Search tickets…');
  const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('filters live in the URL: reload, Back and returning via the sidebar', async ({ page }) => {
    await createTicket(page, title);

    // Typing filters immediately; the URL follows once typing pauses.
    await searchBox(page).fill(title);
    await expect.poll(() => param(page, 'q')).toBe(title);

    // A filter replaces the history entry; a tab pushes one.
    const historyBefore = await page.evaluate(() => history.length);
    await page.getByRole('tab', { name: /Closed/ }).click();
    await expect.poll(() => param(page, 'tab')).toBe('closed');
    expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1);
    await page.goBack();
    await expect.poll(() => param(page, 'tab')).toBeNull();

    // Reload restores the search.
    await page.reload();
    await expect(searchBox(page)).toHaveValue(title);
    await expect(page.locator('li').filter({ hasText: title }).first()).toBeVisible();

    // Opening a ticket, then Back, lands on the filtered list.
    await page.locator('li').filter({ hasText: title }).first().getByText(title).click();
    await expect(page).toHaveURL(/\/app\/tickets\/[a-f0-9]{24}/);
    await page.goBack();
    await expect(searchBox(page)).toHaveValue(title);

    // Leaving and coming back through the sidebar keeps the filters.
    await page.locator('aside').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.locator('aside').getByRole('button', { name: 'Tickets', exact: true }).click();
    await expect.poll(() => param(page, 'q')).toBe(title);
    await expect(searchBox(page)).toHaveValue(title);

    await page.goto('/app/tickets');
    await deleteTicket(page, title);
  });

  test('Copy Link copies the ticket’s absolute URL', async ({ page }) => {
    const copyTitle = `copy-link ticket ${Date.now()}`;
    await createTicket(page, copyTitle);
    await page.locator('li').filter({ hasText: copyTitle }).first().getByText(copyTitle).click();
    await expect(page).toHaveURL(/\/app\/tickets\/[a-f0-9]{24}/);
    const ticketUrl = page.url().split('?')[0];

    await page.getByRole('button', { name: 'Copy link to this ticket' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ticketUrl);

    await deleteTicket(page, copyTitle);
  });
});

test.describe('Deep links: dashboard', () => {
  test.setTimeout(90000);

  const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);

  test('tab and view live in the URL and survive reload and Back', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await page.goto('/app/dashboard');

    await page.getByRole('tab', { name: 'Team', exact: true }).click();
    await expect.poll(() => param(page, 'tab')).toBe('team');
    await page.getByRole('tab', { name: 'Timesheet', exact: true }).click();
    await expect.poll(() => param(page, 'view')).toBe('timesheet');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Timesheet', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.goBack();
    await expect.poll(() => param(page, 'view')).toBeNull();
  });

  test('a legacy timesheet notification link is normalised', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await getTeamIdByCode('TEST01');
    await page.goto(`/app/dashboard?tab=timesheet&teamId=${teamId}`);
    await expect.poll(() => param(page, 'view')).toBe('timesheet');
    expect(param(page, 'tab')).toBe('team');
    // ?teamId= becomes ?team= once the team list has loaded.
    await expect.poll(() => param(page, 'team')).toBe(teamId);
    expect(param(page, 'teamId')).toBeNull();
  });
});

test.describe('Deep links: other pages', () => {
  test.setTimeout(60000);

  const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('Work keeps the selected week in ?date=', async ({ page }) => {
    await page.goto('/app/work');
    await page.getByRole('button', { name: /previous week/i }).click();
    await expect.poll(() => param(page, 'date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const date = param(page, 'date');

    await page.reload();
    expect(param(page, 'date')).toBe(date);
    await page.goBack();
    await expect.poll(() => param(page, 'date')).toBeNull();
  });

  test('a profile that does not exist shows not found', async ({ page }) => {
    await page.goto('/app/profile/nobody-by-this-name-618');
    await expect(noAccessHeading(page, /person doesn.t exist/)).toBeVisible();
  });
});

test.describe('Deep links: signing in', () => {
  test.setTimeout(60000);

  test('a signed-out visitor returns to the link after signing in', async ({ page }) => {
    const teamId = await getTeamIdByCode('TEST01');
    const target = `/app/tickets?team=${teamId}&q=return-to`;
    await page.goto(target);

    await page.fill('input[type="email"]', TEST_USERS.owner1.email);
    await page.fill('input[type="password"]', TEST_USERS.owner1.password);
    await page.click('button:has-text("Sign in")');

    await expect(page).toHaveURL(/\/app\/tickets\?/, { timeout: 30000 });
    expect(new URL(page.url()).searchParams.get('q')).toBe('return-to');
    expect(new URL(page.url()).searchParams.get('team')).toBe(teamId);
  });
});
