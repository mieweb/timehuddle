/**
 * Sending a Redmine issue's time when its ticket timer ends (#688).
 *
 * When a timer stops, or is switched away from, and it left time to send to
 * Redmine, one prompt asks for an optional comment and sends the time either
 * way. Nothing goes until a button is pressed, and closing the prompt leaves
 * the time for the push dialog on the Clock page.
 *
 * The timers here are real ones on TimeHuddle tickets, against the test
 * backend. What is stubbed is everything Redmine: the stop's answer is made to
 * report time left to send (`reportUnsentRedmine`), and the send itself is
 * answered by `stubRedmine`. So these assert what the page asks and sends, and
 * never that the server worked out the right hours, picked the right activity
 * or kept two sends apart; those are unit-tested on the Meteor side.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  connectedStatus,
  preview,
  previewRow,
  pushOutcome,
  stubRedmine,
  today,
} from '../fixtures/redmine';
import { reportUnsentRedmine } from '../fixtures/timers';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

/** 31 minutes on issue #15, left by the timer that just ended. */
const UNSENT = { ticketId: '15', date: today(), hours: 0.52 };

const prompt = (page: Page) => page.getByRole('dialog', { name: 'Send time to Redmine' });
const sent = (overrides = {}) => ({
  ...pushOutcome({ ...UNSENT, storedHours: UNSENT.hours }),
  activityName: 'Development',
  ...overrides,
});

test.describe('Send time to Redmine when a ticket timer ends', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await new ClockPage(page).ensureClockedIn();
    tickets = new TicketsPage(page);
    await tickets.goto();
  });

  // Left clocked in, the next spec's Settings page would find its Redmine URL locked.
  test.afterEach(async ({ page }) => {
    await new ClockPage(page).ensureClockedOut();
  });

  /** A ticket with a running timer, whose stop will report time left to send. */
  async function timedTicket(page: Page, name: string): Promise<string> {
    const title = `E2E ${name} ${Date.now()}`;
    await tickets.createTicket(title);
    await tickets.startTimerButton(title).click();
    await expect(tickets.stopTimerButton(title)).toBeVisible({ timeout: 10000 });
    await reportUnsentRedmine(page, 'timers.stopSession', UNSENT);
    return title;
  }

  test('a stop asks for a comment, and the comment goes with the time', async ({ page }) => {
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent(),
      'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15', seconds: 1860 })] }),
    });
    const title = await timedTicket(page, 'Send Comment');

    await tickets.stopTimerButton(title).click();

    await expect(prompt(page)).toBeVisible();
    // The entry, as a card: the issue with its subject, hours and day.
    await expect(prompt(page)).toContainText('#15 Fix the intake form validation');
    await expect(prompt(page)).toContainText('0:31');
    // The timer has already stopped, and nothing has been sent yet.
    await expect(tickets.startTimerButton(title)).toBeVisible();
    expect(rm.callCount('timeEntries.sendTicketDay')).toBe(0);

    // It read this issue's activities, and nothing else.
    expect(rm.calls('timeEntries.preview')).toContainEqual({ ticketId: '15', date: UNSENT.date });

    await prompt(page).getByLabel('Comment (optional)').fill('Fixed the intake form validation');
    await prompt(page).getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.getByText('Sent 0:31 on #15 to Redmine as Development')).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
    // The activity shown goes with it, though it was left as the default.
    expect(rm.calls('timeEntries.sendTicketDay')).toEqual([
      {
        ticketId: '15',
        date: UNSENT.date,
        comment: 'Fixed the intake form validation',
        activityId: 9,
      },
    ]);
  });

  test('the activity can be changed to another the project allows', async ({ page }) => {
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent({ activityName: 'QA' }),
      'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15', seconds: 1860 })] }),
    });
    const title = await timedTicket(page, 'Send Activity');

    await tickets.stopTimerButton(title).click();

    // The project's own pick is shown, and its other activities are offered.
    const activity = prompt(page).getByRole('combobox', { name: 'Activity' });
    await expect(activity).toContainText('Development');
    await activity.click();
    await page.getByRole('option', { name: 'QA', exact: true }).click();
    await prompt(page).getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.getByText('Sent 0:31 on #15 to Redmine as QA')).toBeVisible();
    expect(rm.calls('timeEntries.sendTicketDay')).toEqual([
      { ticketId: '15', date: UNSENT.date, activityId: 10 },
    ]);
  });

  test('the activity list filters as you type', async ({ page }) => {
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent({ activityName: 'QA' }),
      'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15', seconds: 1860 })] }),
    });
    const title = await timedTicket(page, 'Send Search');

    await tickets.stopTimerButton(title).click();
    await prompt(page).getByRole('combobox', { name: 'Activity' }).click();
    await page.getByPlaceholder('Search activities').fill('qa');

    await expect(page.getByRole('option', { name: 'QA', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Design' })).toHaveCount(0);
    await page.getByRole('option', { name: 'QA', exact: true }).click();
    await prompt(page).getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.getByText('Sent 0:31 on #15 to Redmine as QA')).toBeVisible();
    expect(rm.calls('timeEntries.sendTicketDay')).toEqual([
      { ticketId: '15', date: UNSENT.date, activityId: 10 },
    ]);
  });

  test('plain Enter does not send; Cmd/Ctrl+Enter sends from anywhere', async ({ page }) => {
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent(),
    });
    const first = await timedTicket(page, 'Send Enter');

    await tickets.stopTimerButton(first).click();
    const comment = prompt(page).getByLabel('Comment (optional)');
    await comment.fill('Fixed the form');
    // Send, and the keys with it, wait until the issue's activities have been read.
    await expect(prompt(page).getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    // The comment has focus when the prompt opens: a plain Enter must not send.
    await comment.press('Enter');
    await expect(prompt(page)).toBeVisible();
    await comment.press('ControlOrMeta+Enter');

    await expect(page.getByText('Sent 0:31 on #15 to Redmine as Development')).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);

    const second = await timedTicket(page, 'Send Mod Enter');
    await tickets.stopTimerButton(second).click();
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page).getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await prompt(page).getByRole('button', { name: 'Later' }).focus();
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(prompt(page)).toHaveCount(0);
    expect(rm.calls('timeEntries.sendTicketDay')).toEqual([
      { ticketId: '15', date: UNSENT.date, comment: 'Fixed the form' },
      { ticketId: '15', date: UNSENT.date },
    ]);
  });

  test('the prompt fits a phone, with nothing cut off', async ({ page }) => {
    await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent(),
      'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15', seconds: 1860 })] }),
    });
    const title = await timedTicket(page, 'Send Phone');
    const narrow = { width: 360, height: 740 };
    await page.setViewportSize(narrow);

    await tickets.stopTimerButton(title).click();
    await expect(prompt(page)).toBeVisible();

    for (const control of [
      prompt(page).getByRole('combobox', { name: 'Activity' }),
      prompt(page).getByLabel('Comment (optional)'),
      prompt(page).getByRole('button', { name: 'Later' }),
      prompt(page).getByRole('button', { name: 'Send', exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(narrow.width);
    }
    await prompt(page).getByRole('button', { name: 'Later' }).click();
  });

  test('the time can be sent without a comment', async ({ page }) => {
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent(),
    });
    const title = await timedTicket(page, 'Send Plain');

    await tickets.stopTimerButton(title).click();

    await prompt(page).getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.getByText('Sent 0:31 on #15 to Redmine as Development')).toBeVisible();
    expect(rm.calls('timeEntries.sendTicketDay')).toEqual([{ ticketId: '15', date: UNSENT.date }]);
  });

  test('a switch starts the next timer, then asks about the ticket it left', async ({ page }) => {
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent(),
    });
    const stamp = Date.now();
    const first = `E2E Send From ${stamp}`;
    const second = `E2E Send To ${stamp}`;
    await tickets.createTicket(first);
    await tickets.createTicket(second);
    await tickets.startTimerButton(first).click();
    await expect(tickets.stopTimerButton(first)).toBeVisible({ timeout: 10000 });
    await reportUnsentRedmine(page, 'timers.createEntry', UNSENT);

    await tickets.startTimerButton(second).click();

    // The second timer is running while the prompt is still unanswered.
    await expect(prompt(page)).toBeVisible();
    await expect(page.getByText(`Started ${second}`)).toBeVisible();
    expect(rm.callCount('timeEntries.sendTicketDay')).toBe(0);

    await prompt(page).getByRole('button', { name: 'Send', exact: true }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(tickets.stopTimerButton(second)).toBeVisible();

    await page.unroute('**/api/timers_createEntry');
    await tickets.stopTimerButton(second).click();
  });

  test('a refused send says why, and the time is in the push dialog', async ({ page }) => {
    await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent({
        ok: false,
        reason: 'rejected-by-redmine',
        detail: ['Activity is not included in the list'],
        entryId: undefined,
        storedHours: undefined,
      }),
      'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15', seconds: 1860 })] }),
    });
    const title = await timedTicket(page, 'Send Refused');

    await tickets.stopTimerButton(title).click();
    await prompt(page).getByRole('button', { name: 'Send', exact: true }).click();

    await expect(
      page.getByText(
        'Time on #15 was not sent to Redmine: Redmine: Activity is not included in the list. It is waiting on the Clock page.',
      ),
    ).toBeVisible();

    const clock = new ClockPage(page);
    await clock.ensureClockedOut();
    await expect(page.getByText('Redmine time ready to send')).toBeVisible();
  });

  test('Later sends nothing', async ({ page }) => {
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent(),
    });
    const title = await timedTicket(page, 'Send Not Now');

    await tickets.stopTimerButton(title).click();
    await prompt(page).getByRole('button', { name: 'Later' }).click();

    await expect(prompt(page)).toHaveCount(0);
    expect(rm.callCount('timeEntries.sendTicketDay')).toBe(0);
  });

  test('closing the prompt sends nothing', async ({ page }) => {
    const rm = await stubRedmine(page, {
      status: connectedStatus(),
      'timeEntries.sendTicketDay': sent(),
    });
    const title = await timedTicket(page, 'Send Later');

    await tickets.stopTimerButton(title).click();
    await expect(prompt(page)).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(prompt(page)).toHaveCount(0);
    expect(rm.callCount('timeEntries.sendTicketDay')).toBe(0);
  });
});
