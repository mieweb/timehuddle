/**
 * Redmine suggestions in the Tickets search bar (MVP2 Part B).
 *
 * One input, two jobs: it filters the table, and it opens a dropdown of Redmine
 * issues — "Suggested for you" on focus, "More from Redmine" from a server search.
 * Redmine is stubbed at the wormhole boundary (`fixtures/redmine.ts`), so these
 * assert what the UI does with a given answer, not how the server ranks.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';
import {
  BASE_URL,
  connectedStatus,
  redmineIssue,
  relevantList,
  stubRedmine,
  type RedmineIssueShape,
  type StubValue,
} from '../fixtures/redmine';
import { stubMyBoard, stubRunningTimer, stubTimerCreate } from '../fixtures/timers';

type Reason = 'running' | 'assigned' | 'logged' | 'activity' | 'watching' | 'pinned';

const suggestion = (id: number, subject: string, reasons: Reason[] = ['assigned']) => ({
  ...redmineIssue({ id, subject }),
  reasons,
  score: 60,
});

const SUGGESTED = [
  suggestion(15, 'Alpha intake validation'),
  suggestion(23, 'Zulu export timeout', ['watching']),
  suggestion(31, 'Kilo billing report', ['activity']),
];

const relevant = (issues = SUGGESTED) => relevantList(issues);

const searchResult = (kind: string, issues: RedmineIssueShape[]) => ({
  connected: true,
  baseUrl: BASE_URL,
  kind,
  issues,
});

async function openTickets(page: Page, overrides: Record<string, StubValue> = {}) {
  const rm = await stubRedmine(page, {
    status: connectedStatus(),
    'issues.relevant': relevant(),
    ...overrides,
  });
  const tickets = new TicketsPage(page);
  await tickets.goto();
  const input = tickets.searchInput;
  const menu = page.getByRole('listbox', { name: 'Redmine suggestions' });
  const option = (name: string | RegExp) => menu.getByRole('option', { name });
  return { rm, tickets, input, menu, option };
}

test.describe('Redmine search suggestions', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('shows suggested issues when the empty search bar is focused', async ({ page }) => {
    const { rm, input, menu, option } = await openTickets(page);

    await input.click();

    await expect(menu.getByText('Suggested for you')).toBeVisible();
    await expect(menu.getByRole('option')).toHaveCount(3);
    await expect(option(/Alpha intake validation/)).toBeVisible();
    await expect(option(/Alpha intake validation/)).toContainText('#15');
    // The dropdown asks without `includeDismissed`, the table with it.
    await expect
      .poll(() => rm.calls('issues.relevant').some((c) => !c.includeDismissed))
      .toBe(true);
    expect(rm.calls('issues.relevant').some((c) => c.includeDismissed === true)).toBe(true);
  });

  test('typing narrows the suggestions and still filters the table', async ({ page }) => {
    const { tickets, input, menu, option } = await openTickets(page);

    await input.fill('alpha');

    await expect(menu.getByRole('option')).toHaveCount(1);
    await expect(option(/Alpha intake validation/)).toBeVisible();
    await input.press('Escape');
    await expect(menu).toBeHidden();
    await expect(input).toHaveValue('alpha');
    await expect(tickets.rowByTitle('Alpha intake validation')).toBeVisible();
  });

  test('the table lists only assigned issues; the rest are suggestions', async ({ page }) => {
    const { tickets, input, option } = await openTickets(page);

    await tickets.filterBySource('Redmine');
    await expect(tickets.rowByTitle('Alpha intake validation')).toBeVisible();
    await expect(tickets.rowByTitle('Zulu export timeout')).toHaveCount(0);
    await expect(tickets.rowByTitle('Kilo billing report')).toHaveCount(0);

    await input.click();
    await expect(option(/Zulu export timeout/)).toBeVisible();
    await expect(option(/Kilo billing report/)).toBeVisible();
  });

  test('adds new issues from a server search under "More from Redmine"', async ({ page }) => {
    const { rm, input, menu, option } = await openTickets(page, {
      'issues.search': searchResult('text', [
        redmineIssue({ id: 15, subject: 'Alpha intake validation' }),
        redmineIssue({ id: 77, subject: 'Alpha printer queue' }),
      ]),
    });

    await input.fill('alpha');

    await expect(menu.getByText('More from Redmine')).toBeVisible();
    await expect(option(/Alpha printer queue/)).toBeVisible();
    // #15 is already in the table and the suggestions, so it is not offered twice.
    await expect(option(/Alpha intake validation/)).toHaveCount(1);
    expect(rm.calls('issues.search').at(-1)).toEqual({ query: 'alpha' });
  });

  test('on My Board, a search still finds an issue that is only in All Sources', async ({
    page,
  }) => {
    // #40 is assigned, so it is in the All Sources table, but the user hid it
    // from their suggestions and it is not on their board.
    const hidden = suggestion(40, 'Hidden export job');
    await stubRedmine(page, {
      status: connectedStatus(),
      'issues.relevant': (params: { includeDismissed?: boolean }) =>
        relevant(params.includeDismissed ? [...SUGGESTED, hidden] : SUGGESTED),
      'issues.search': searchResult('text', [redmineIssue({ id: 40, subject: hidden.subject })]),
    });
    const tickets = new TicketsPage(page);
    // Not `tickets.goto()`, which switches to All Sources: this is about the default view.
    await page.goto('/app/tickets');
    await tickets.heading.waitFor({ state: 'visible' });
    const menu = page.getByRole('listbox', { name: 'Redmine suggestions' });
    const found = menu.getByRole('option', { name: /Hidden export job/ });

    // The board does not have it, so the search has to.
    await tickets.searchInput.fill('hidden export');
    await expect(tickets.rowByTitle('Hidden export job')).toHaveCount(0);
    await expect(found).toBeVisible();

    // In All Sources it is a row in the table, so it is not offered a second time.
    await tickets.switchToTab('tickets');
    await expect(tickets.rowByTitle('Hidden export job')).toBeVisible();
    await tickets.searchInput.click();
    await expect(menu).toBeVisible();
    await expect(found).toHaveCount(0);
  });

  test('finds an issue by number straight away', async ({ page }) => {
    const { rm, input, option } = await openTickets(page, {
      'issues.search': searchResult('id', [redmineIssue({ id: 4242, subject: 'Remote issue' })]),
    });

    await input.fill('#4242');

    await expect(option(/Remote issue/)).toBeVisible();
    expect(rm.calls('issues.search').at(-1)).toEqual({ query: '#4242' });
  });

  test('explains an empty result by how the query was read', async ({ page }) => {
    const { input } = await openTickets(page, {
      'issues.search': searchResult('assignee', []),
    });

    await input.fill('@zz');

    await expect(
      page.getByRole('status').getByText(/No single person matches “@zz”/),
    ).toBeVisible();
  });

  test('opens the issue on Enter', async ({ page }) => {
    const { input, menu } = await openTickets(page);

    await input.click();
    await expect(menu.getByRole('option').first()).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Enter');

    await expect(page).toHaveURL(/\/app\/tickets\/redmine\/15$/);
  });

  test('hides a suggestion with the x, and Undo brings it back', async ({ page }) => {
    const { rm, tickets, input, menu, option } = await openTickets(page);

    await input.click();
    const row = option(/Alpha intake validation/);
    await row.hover();
    await row.getByLabel('Hide #15 from suggestions').click();

    await expect(row).toHaveCount(0);
    await expect(menu).toBeVisible();
    expect(rm.calls('prefs.set').at(-1)).toEqual({ issueId: 15, state: 'dismissed' });

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => rm.calls('prefs.set').at(-1)).toEqual({ issueId: 15, state: null });
    await input.click();
    await expect(option(/Alpha intake validation/)).toBeVisible();

    // Hiding a suggestion never touched the table.
    await tickets.search('Alpha intake');
    await expect(tickets.rowByTitle('Alpha intake validation')).toBeVisible();
  });

  test('Delete hides the highlighted suggestion from the keyboard', async ({ page }) => {
    const { rm, input, menu, option } = await openTickets(page);

    await input.click();
    await expect(menu.getByRole('option').first()).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Delete');

    await expect(option(/Alpha intake validation/)).toHaveCount(0);
    await expect(option(/Zulu export timeout/)).toBeVisible();
    expect(rm.calls('prefs.set').at(-1)).toEqual({ issueId: 15, state: 'dismissed' });
  });

  test('puts the row back when the server refuses to hide it', async ({ page }) => {
    const { input, menu, option } = await openTickets(page, {
      'prefs.set': { error: 'unreachable', status: 500 },
    });

    await input.click();
    await expect(menu.getByRole('option').first()).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Delete');

    await expect(page.getByText("Couldn't hide #15. Please try again.")).toBeVisible();
    await input.click();
    await expect(option(/Alpha intake validation/)).toBeVisible();
  });

  test('offers to connect Redmine when no account is linked', async ({ page }) => {
    const { input, option } = await openTickets(page, {
      status: { connected: false },
      'issues.relevant': { connected: false, baseUrl: null, issues: [], partial: false },
    });

    await input.click();
    await option('Connect Redmine to see your issues').click();

    await expect(page).toHaveURL(/\/app\/settings/);
  });

  test('says so quietly when some signals did not answer', async ({ page }) => {
    const { input, menu } = await openTickets(page, {
      'issues.relevant': { connected: true, baseUrl: BASE_URL, issues: SUGGESTED, partial: true },
    });

    await input.click();

    await expect(
      page.getByRole('status').getByText('Some Redmine results are still unavailable.'),
    ).toBeVisible();
    await expect(menu.getByRole('option')).toHaveCount(3);
  });

  test('keeps rows readable at 320 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const { input, menu, option } = await openTickets(page, {
      'issues.relevant': relevant([
        suggestion(
          15,
          'A very long Redmine issue title that would never fit in one line at this width',
        ),
        suggestion(23, 'Zulu'),
      ]),
    });

    await input.click();
    const row = option(/A very long Redmine issue title/);
    await expect(row).toBeVisible();
    const title = row.getByText(/A very long Redmine issue title/);
    const shortTitle = option(/Zulu/).getByText('Zulu');

    // The title wraps to show all of its text: taller than a one-line title,
    // and nothing of it cut off.
    const titleBox = (await title.boundingBox())!;
    const oneLine = (await shortTitle.boundingBox())!.height;
    expect(titleBox.height).toBeGreaterThan(oneLine * 1.5);
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    // It stays inside the row, and the row inside the dropdown and the screen.
    const rowBox = (await row.boundingBox())!;
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(320);
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await menu.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
});

test.describe('Redmine suggestion timers', () => {
  let clock: ClockPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    clock = new ClockPage(page);
  });

  /** The test backend has no Redmine, so the timer start itself is stubbed. */
  async function stubTimerStart(page: Page, { onBoard = [] as string[] } = {}) {
    const bodies = await stubTimerCreate(page);
    // My Board, so "added" versus "already there" is deterministic.
    const { adds: boardAdds } = await stubMyBoard(
      page,
      onBoard.map((ticketId) => ({ sourceId: 'redmine', ticketId })),
    );
    return { bodies, boardAdds };
  }

  test('Shift+Enter starts a timer on the highlighted suggestion', async ({ page }) => {
    await clock.ensureClockedIn();
    const { bodies, boardAdds } = await stubTimerStart(page);
    const { input, menu } = await openTickets(page);

    await input.click();
    await expect(menu.getByRole('option').first()).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Shift+Enter');

    await expect(page.getByText('Started #15')).toBeVisible();
    expect(bodies[0]).toMatchObject({ ticketId: '15', source: 'redmine', startNow: true });
    expect(boardAdds[0]).toEqual({ refs: [{ sourceId: 'redmine', ticketId: '15' }] });
  });

  test('the timer icon starts one too, without opening the issue', async ({ page }) => {
    await clock.ensureClockedIn();
    const { bodies, boardAdds } = await stubTimerStart(page, { onBoard: ['23'] });
    const { input, option } = await openTickets(page);

    await input.click();
    const row = option(/Zulu export timeout/);
    await row.hover();
    await row.getByLabel('Start a timer on #23').click();

    // Already on My Board, so it is not added a second time.
    await expect(page.getByText('Started #23')).toBeVisible();
    expect(boardAdds).toHaveLength(0);
    expect(bodies[0]).toMatchObject({ ticketId: '23', source: 'redmine' });
    await expect(page).toHaveURL(/\/app\/tickets(\?|$)/);
  });

  test('the timer icon shows on every row; My Board and hide wait for the hovered one (#672)', async ({
    page,
  }) => {
    await stubTimerStart(page, { onBoard: ['23'] });
    const { input, menu, option } = await openTickets(page);

    await input.click();
    await expect(menu.getByRole('option')).toHaveCount(3);
    // Nothing is highlighted, and the pointer is on no row.
    await page.mouse.move(0, 0);
    await expect(menu.locator('[aria-selected="true"]')).toHaveCount(0);

    // On or off My Board, the label differs; every row has the one button.
    await expect(menu.getByLabel(/timer/i)).toHaveCount(3);
    for (const subject of SUGGESTED.map((issue) => issue.subject)) {
      await expect(option(new RegExp(subject)).getByLabel(/timer/i)).toBeVisible();
    }
    const row = option(/Zulu export timeout/);
    const timer = row.getByLabel('Start a timer on #23');
    const board = row.getByLabel('Remove #23 from My Board');
    const hide = row.getByLabel('Hide #23 from suggestions');
    await expect(board).toBeHidden();
    await expect(hide).toBeHidden();
    const timerBefore = await timer.boundingBox();
    const titleBefore = await row.getByText('Zulu export timeout').boundingBox();

    await row.hover();

    await expect(board).toBeVisible();
    await expect(hide).toBeVisible();
    // Their space was kept, so showing them moves nothing.
    expect(await timer.boundingBox()).toEqual(timerBefore);
    expect(await row.getByText('Zulu export timeout').boundingBox()).toEqual(titleBefore);
    // The other rows' stay hidden.
    await expect(option(/Alpha intake validation/).getByLabel(/My Board$/)).toBeHidden();
  });

  test('the board button adds an issue to My Board without starting a timer (#672)', async ({
    page,
  }) => {
    const { bodies, boardAdds } = await stubTimerStart(page);
    const { input, option } = await openTickets(page);

    await input.click();
    const row = option(/Zulu export timeout/);
    await row.hover();
    await row.getByLabel('Add #23 to My Board', { exact: true }).click();

    expect(boardAdds[0]).toEqual({ refs: [{ sourceId: 'redmine', ticketId: '23' }] });
    expect(bodies).toHaveLength(0);
    // The menu stays open, and the row now offers to take the issue off again.
    await row.hover();
    await expect(row.getByLabel('Remove #23 from My Board')).toBeVisible();
    await expect(row.getByLabel('Start a timer on #23')).toBeVisible();
  });

  test('Alt+Enter adds the highlighted suggestion to My Board (#672)', async ({ page }) => {
    const { bodies, boardAdds } = await stubTimerStart(page);
    const { input, menu } = await openTickets(page);

    await input.click();
    await expect(menu.getByRole('option').first()).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Alt+Enter');

    await expect
      .poll(() => boardAdds)
      .toEqual([{ refs: [{ sourceId: 'redmine', ticketId: '15' }] }]);
    expect(bodies).toHaveLength(0);
    await expect(menu.getByRole('option').first()).toBeVisible();
  });

  test('a timer on an issue you do not own adds it to the table, then My Board', async ({
    page,
  }) => {
    await clock.ensureClockedIn();
    const { boardAdds } = await stubTimerStart(page);
    // The server answers with the issue as pinned only once it has been pinned.
    let pinned = false;
    const { rm, tickets, input, option } = await openTickets(page, {
      'prefs.set': (params) => {
        if (params.state === 'pinned') pinned = true;
        return { ok: true };
      },
      'issues.relevant': () =>
        relevant(
          SUGGESTED.map((issue) =>
            issue.id === 31 && pinned ? { ...issue, reasons: ['pinned', 'activity'] } : issue,
          ),
        ),
    });

    await tickets.filterBySource('Redmine');
    await expect(tickets.rowByTitle('Kilo billing report')).toHaveCount(0);

    await input.click();
    const row = option(/Kilo billing report/);
    await row.hover();
    await row.getByLabel('Add #31 to My Board and start timer').click();

    await expect(page.getByText('Started #31')).toBeVisible();
    expect(rm.calls('prefs.set')).toContainEqual({ issueId: 31, state: 'pinned' });
    expect(boardAdds[0]).toEqual({ refs: [{ sourceId: 'redmine', ticketId: '31' }] });
    await expect(tickets.rowByTitle('Kilo billing report')).toBeVisible();

    await tickets.switchToTab('my-board');
    await expect(tickets.rowByTitle('Kilo billing report')).toBeVisible();
    await expect(page.getByText(/no longer available/)).toHaveCount(0);
  });

  test('at the pin limit the timer starts, but the issue stays off the table and My Board', async ({
    page,
  }) => {
    await clock.ensureClockedIn();
    const { bodies, boardAdds } = await stubTimerStart(page);
    const { rm, tickets, input, option } = await openTickets(page, {
      'prefs.set': { error: 'too-many-pins', status: 500 },
    });

    await tickets.filterBySource('Redmine');
    await input.click();
    const row = option(/Kilo billing report/);
    await row.hover();
    await row.getByLabel('Add #31 to My Board and start timer').click();

    await expect(
      page.getByText(
        "Started #31. You've reached the 500-pin limit, so it wasn't added to your Tickets or My Board.",
      ),
    ).toBeVisible();
    expect(bodies[0]).toMatchObject({ ticketId: '31', source: 'redmine' });
    expect(rm.calls('prefs.set')).toContainEqual({ issueId: 31, state: 'pinned' });
    expect(boardAdds).toHaveLength(0);
    await expect(tickets.rowByTitle('Kilo billing report')).toHaveCount(0);
  });

  test('asks to clock in first when there is no shift', async ({ page }) => {
    // The earlier tests leave a shift open, and ensureClockedOut can look before
    // the clock controls have loaded. Retry until the Clock page offers "Clock in".
    await expect(async () => {
      await clock.ensureClockedOut();
      await expect(clock.clockInButton).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    const { input, menu } = await openTickets(page);

    await input.click();
    await expect(menu.getByRole('option').first()).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Shift+Enter');

    await expect(page.getByRole('heading', { name: 'Clock In Required' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Hidden suggestions in Settings', () => {
  test('lists hidden issues, and Restore brings one back', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'prefs.listDismissed': {
        connected: true,
        baseUrl: BASE_URL,
        issues: [redmineIssue({ id: 15, subject: 'Alpha intake validation' })],
      },
    });
    await page.goto('/app/settings');

    const section = page.getByRole('region', { name: 'Hidden suggestions' });
    await expect(section.getByText('Alpha intake validation')).toBeVisible();

    await section.getByRole('button', { name: 'Restore #15 to suggestions' }).click();

    await expect(section.getByText('Alpha intake validation')).toHaveCount(0);
    expect(rm.calls('prefs.set').at(-1)).toEqual({ issueId: 15, state: null });
  });
});

test.describe('The running timer in suggestions', () => {
  test('follows the live timer: shown while timed, gone as soon as it stops', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    // The server's list says nothing about a timer; the page's own running-timer
    // tracking is what must drive the chip.
    let running = true;
    await stubRunningTimer(page, {
      ticketId: '23',
      title: 'Zulu export timeout',
      isRunning: () => running,
    });
    const { input, option } = await openTickets(page);

    await input.click();
    const row = option(/Zulu export timeout/);
    await expect(row.getByText('Timer running').last()).toBeVisible();
    await row.hover();
    await expect(row.getByLabel('Stop the timer on #23')).toBeVisible();

    running = false;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('tickets:refetch')));

    await expect(row.getByText('Timer running')).toHaveCount(0);
    // Whichever start it is: the name depends on whether #23 is on My Board.
    await expect(
      row.getByLabel(/^(Start a timer on #23|Add #23 to My Board and start timer)$/),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(row.getByText('Watching').last()).toBeVisible();
  });
});
