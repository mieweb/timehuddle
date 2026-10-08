/**
 * Automatic Huddle updates for ticket timers (#681): a start or stop posts a
 * one-line update on the person's behalf, the toast links to it, and leaving a
 * ticket after under two minutes asks whether the update is worth keeping.
 *
 * Runs against the real backend, so a passing run means the post was really
 * written (and, for a discard, really removed).
 */
import { test, expect } from '@playwright/test';

import { askAboutShortStints, shortStintQuestion } from '../fixtures/timers';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { findPostByText, inboxMessage } from '../huddle/helpers';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

test.describe('Huddle updates for ticket timers', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await new ClockPage(page).ensureClockedIn();
    tickets = new TicketsPage(page);
    await tickets.goto();
  });

  test('a start posts an update, and the toast opens it in Huddle', async ({ page }) => {
    const title = `E2E Update ${Date.now()}`;
    await tickets.createTicket(title);

    await tickets.startTimerButton(title).click();

    await expect(page.getByText(`Started ${title}`, { exact: true })).toBeVisible();
    // Named by its short reference and title: "Started #3fa2c: <title>".
    await expect
      .poll(async () => (await findPostByText(`: ${title}](`))?.content.text ?? '')
      .toMatch(/^\*Started \[#\w{5}: /);

    await page.getByRole('button', { name: 'View post' }).click();

    await expect(page).toHaveURL(/\/app\/huddle/);
    const update = inboxMessage(page, `: ${title}`);
    await expect(update).toBeVisible({ timeout: 15000 });
    await expect(update).toContainText('Started #');

    // The ticket's name is a link, and it opens the ticket here, not in a new tab.
    await update.getByRole('link').click();
    await expect(page).toHaveURL(/\/app\/tickets\/[0-9a-f]{24}$/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // Leave nothing running for the next spec.
    await tickets.goto();
    await tickets.stopTimerButton(title).click();
    await expect(tickets.startTimerButton(title)).toBeVisible();
  });

  test('stopping within two minutes asks, and Discard removes the update', async ({ page }) => {
    await askAboutShortStints(page);
    const title = `E2E Discard ${Date.now()}`;
    await tickets.createTicket(title);
    await tickets.startTimerButton(title).click();
    await expect.poll(() => findPostByText(`: ${title}](`)).not.toBeNull();

    await tickets.stopTimerButton(title).click();

    await expect(shortStintQuestion(page)).toBeVisible();
    await expect(page.getByText(/stopping .* after less than 2 minutes/)).toBeVisible();
    await page.getByRole('button', { name: 'Discard update' }).click();

    await expect(tickets.startTimerButton(title)).toBeVisible();
    // The "Started" update is gone, and no "Stopped" one took its place.
    await expect.poll(() => findPostByText(`: ${title}](`)).toBeNull();
  });

  test('closing the question leaves the timer running', async ({ page }) => {
    await askAboutShortStints(page);
    const title = `E2E Keep Running ${Date.now()}`;
    await tickets.createTicket(title);
    await tickets.startTimerButton(title).click();
    await expect(tickets.stopTimerButton(title)).toBeVisible();

    await tickets.stopTimerButton(title).click();
    await expect(shortStintQuestion(page)).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(shortStintQuestion(page)).toHaveCount(0);
    await expect(tickets.stopTimerButton(title)).toBeVisible();

    // Stop for real, keeping the update.
    await tickets.stopTimerButton(title).click();
    await page.getByRole('button', { name: 'Keep update' }).click();
    await expect(tickets.startTimerButton(title)).toBeVisible();
  });
});
