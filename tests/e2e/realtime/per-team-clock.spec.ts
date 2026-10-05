/**
 * The per-team clock across devices.
 *
 * Each team has its own clock: a person can be on the clock in two teams at
 * once, each team's Clock page shows its own shift, and a shift open in the
 * other team is named ("Also on the clock in …") rather than shown under this
 * team's name. `TeamContext` follows the user's open shifts in every team
 * live (`clock.liveOpenShifts`), so a clock-in or clock-out in one device
 * reaches the other without a reload, whatever team each has selected.
 *
 * Two browser contexts, one user: device 1 works in a fresh team, device 2 in
 * the shared seed team.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { createTestTeam, selectSharedTestTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

const SHARED_TEAM_NAME = 'Test Team Alpha';

const alsoOnTheClock = (page: Page, teamName: string) =>
  page.getByText(`Also on the clock in ${teamName}`, { exact: true });

test.describe('Per-team clock', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let device1: Page;
  let device2: Page;
  let clock1: ClockPage;
  let clock2: ClockPage;
  let ownTeamName: string;

  test.beforeEach(async ({ browser }) => {
    context1 = await browser.newContext();
    context2 = await browser.newContext();
    device1 = await context1.newPage();
    device2 = await context2.newPage();
    await loginAs(device1, TEST_USERS.admin1);
    await loginAs(device2, TEST_USERS.admin1);

    // Device 2 on the shared team, clocked out there.
    await selectSharedTestTeam(device2);
    clock2 = new ClockPage(device2);
    await clock2.ensureClockedOut();

    // Device 1 on a team of its own (a new team starts clocked out).
    ownTeamName = await createTestTeam(device1, 'PerTeamClock');
    clock1 = new ClockPage(device1);
    await clock1.goto();
  });

  test.afterEach(async () => {
    await clock1?.ensureClockedOut().catch(() => {});
    await clock2?.ensureClockedOut().catch(() => {});
    await context1?.close();
    await context2?.close();
  });

  test('each team keeps its own clock, and the other device hears about it live', async () => {
    await clock2.goto();
    await expect(clock1.clockInButton).toBeVisible();

    // Clock in to the own team on device 1.
    await clock1.clockIn();

    // Device 2 (shared team) is still clocked out there and can clock in,
    // and names the other team's shift without a reload.
    await expect(alsoOnTheClock(device2, ownTeamName)).toBeVisible({ timeout: 10000 });
    expect(await clock2.isClockedIn()).toBe(false);

    // Clock in to the shared team too; both shifts are open at once.
    await clock2.ensureClockedIn('Plan for the per-team clock test');
    expect(await clock2.isClockedIn()).toBe(true);
    await expect(alsoOnTheClock(device1, SHARED_TEAM_NAME)).toBeVisible({ timeout: 10000 });
    expect(await clock1.isClockedIn()).toBe(true);

    // Clocking out of the shared team on device 2 reaches device 1 live, and
    // leaves device 1's own shift running.
    await clock2.ensureClockedOut();
    await expect(alsoOnTheClock(device1, SHARED_TEAM_NAME)).toHaveCount(0, { timeout: 10000 });
    expect(await clock1.isClockedIn()).toBe(true);
  });

  test("clocking out of one team leaves the other team's ticket timer running", async () => {
    await clock1.clockIn();
    await clock2.ensureClockedIn('Plan for the per-team timer test');

    // A ticket of device 1's team, timed inside that team's shift.
    const title = `Per Team Timer ${Date.now()}`;
    const board1 = new TicketsPage(device1);
    await board1.goto();
    await board1.createTicket(title);
    await board1.moveToBoard(title);
    await board1.startTimerButton(title).click();
    await expect(board1.stopTimerButton(title)).toBeVisible({ timeout: 10000 });

    // Clock out of the shared team.
    await clock2.ensureClockedOut();
    expect(await clock2.isClockedIn()).toBe(false);

    // Device 1's shift and its ticket timer are still running.
    await board1.goto();
    await board1.switchToTab('my-board');
    await expect(board1.stopTimerButton(title)).toBeVisible({ timeout: 10000 });
    await clock1.goto();
    expect(await clock1.isClockedIn()).toBe(true);
  });
});
