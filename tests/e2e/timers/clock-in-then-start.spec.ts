/**
 * Clock in, then start any ticket, from anywhere (#586).
 *
 * Every ticket timer start goes through one app-wide flow (TicketStartProvider):
 * clocked out, one "Clock In Required" prompt; on a plan-required team, the
 * prompt sends you to the Clock page and the timer starts by itself once you
 * have clocked in. Every start and switch is confirmed in a toast naming the
 * ticket. These drive it with Huddle tickets against the real test backend;
 * the Redmine issue page's side is in `redmine/issue-detail.spec.ts`.
 */
import { test, expect, type Page } from '@playwright/test';

import { createPlanRequiredTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

/** A single row of the Work page's day table, by work-item title. */
const workRow = (page: Page, title: string) =>
  page
    .getByRole('table', { name: /Work items for/ })
    .locator('tbody tr')
    .filter({ hasText: title });

test.describe('Clock in, then start a ticket timer', () => {
  let clock: ClockPage;
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    clock = new ClockPage(page);
    tickets = new TicketsPage(page);
  });

  test('clocked out: the prompt clocks in, starts the timer and says so', async ({ page }) => {
    const title = `E2E Clock-in Start ${Date.now()}`;
    await clock.ensureClockedIn();
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);
    await clock.ensureClockedOut();

    await tickets.goto();
    await tickets.switchToTab('my-board');
    await tickets.startTimerButton(title).click();
    await expect(page.getByRole('heading', { name: 'Clock In Required' })).toBeVisible();
    await page.getByRole('button', { name: 'Clock In Now' }).click();

    await expect(tickets.stopTimerButton(title)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`Timer started on ${title}. It's on My Board`)).toBeVisible();

    await tickets.stopTimerButton(title).click();
    await expect(page.getByText(`Timer stopped on ${title}`)).toBeVisible();
  });

  test('switching tickets names the one that stopped', async ({ page }) => {
    await clock.ensureClockedIn();
    const stamp = Date.now();
    const first = `E2E Switch From ${stamp}`;
    const second = `E2E Switch To ${stamp}`;
    await tickets.goto();
    await tickets.createTicket(first);
    await tickets.createTicket(second);
    await tickets.selectTicket(first);
    await tickets.selectTicket(second);
    await tickets.moveToBoardButton.click();
    await tickets.switchToTab('my-board');

    await tickets.startTimerButton(first).click();
    await expect(tickets.stopTimerButton(first)).toBeVisible({ timeout: 10000 });
    await tickets.startTimerButton(second).click();

    await expect(
      page.getByText(`Stopped ${first}. Timer started on ${second}. It's on My Board`),
    ).toBeVisible();
    await expect(tickets.startTimerButton(first)).toBeVisible();

    // With a timer running, the Clock page says clocking out will stop it.
    await clock.goto();
    await expect(page.getByText(`Clocking out will stop the timer on ${second}.`)).toBeVisible();
    await tickets.goto();
    await tickets.switchToTab('my-board');
    await tickets.stopTimerButton(second).click();
  });

  test('the Work page starts through the same prompt', async ({ page }) => {
    const title = `E2E Work Start ${Date.now()}`;
    // A work item exists once a ticket has been timed from My Board.
    await clock.ensureClockedIn();
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);
    await tickets.startTimerButton(title).click();
    await expect(tickets.stopTimerButton(title)).toBeVisible({ timeout: 10000 });
    await clock.ensureClockedOut();

    await page.goto('/app/work');
    const row = workRow(page, title);
    await row.getByRole('button', { name: 'Start timer' }).click();
    await expect(page.getByRole('heading', { name: 'Clock In Required' })).toBeVisible();
    await page.getByRole('button', { name: 'Clock In Now' }).click();

    await expect(row.getByRole('button', { name: 'Stop timer' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`Timer started on ${title}`)).toBeVisible();
    await row.getByRole('button', { name: 'Stop timer' }).click();
  });

  test('plan required: plan on the Clock page, then the timer starts and you are back', async ({
    page,
  }) => {
    test.slow();
    await clock.ensureClockedOut();
    await createPlanRequiredTeam(page);

    const title = `E2E Plan Start ${Date.now()}`;
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);

    await tickets.startTimerButton(title).click();
    await expect(
      page.getByText(/Your team asks for today's plan before you clock in/),
    ).toBeVisible();
    await page.getByRole('button', { name: "Write today's plan" }).click();

    await expect(page).toHaveURL(/\/app\/clock$/);
    await expect(page.getByText(`The timer on ${title} starts when you clock in.`)).toBeVisible();
    await clock.typePlan(`Plan before timing ${title}`);
    await clock.postPlanAndClockIn();

    // Back where the start was asked for, with the timer running.
    await expect(page).toHaveURL(/\/app\/tickets$/, { timeout: 15000 });
    await expect(page.getByText(`Timer started on ${title}. It's on My Board`)).toBeVisible();
    await tickets.switchToTab('my-board');
    await expect(tickets.stopTimerButton(title)).toBeVisible({ timeout: 10000 });

    await tickets.stopTimerButton(title).click();
    await clock.ensureClockedOut();
  });

  test('a waiting start can be cancelled from the Clock page', async ({ page }) => {
    test.slow();
    await clock.ensureClockedOut();
    await createPlanRequiredTeam(page);

    const title = `E2E Plan Cancel ${Date.now()}`;
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);
    await tickets.startTimerButton(title).click();
    await page.getByRole('button', { name: "Write today's plan" }).click();

    await page.getByRole('button', { name: `Don't start the timer on ${title}` }).click();
    await expect(page.getByText(`The timer on ${title} starts when you clock in.`)).toHaveCount(0);

    await clock.typePlan('Plan without a waiting timer');
    await clock.postPlanAndClockIn();
    // Clocked in, still on the Clock page, and nothing was started.
    await expect(page).toHaveURL(/\/app\/clock$/);
    await expect(page.getByText(/Clocking out will stop the timer/)).toHaveCount(0);
    await clock.ensureClockedOut();
  });
});
