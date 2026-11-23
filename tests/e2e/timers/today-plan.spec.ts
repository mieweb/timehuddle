/**
 * Today's plan while clocked in (M4, #886): the plan stays in the rich editor
 * it was written in, read-only, every ticket a checklist line with its timer
 * button in front of it and the running time under the button. Ticks and
 * switches are saved at once (touch and go).
 */
import { test, expect } from '@playwright/test';

import { selectSharedTestTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { setSharedTeamPlanGate } from '../huddle/helpers';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

test.describe("Today's plan in the editor", () => {
  test.beforeAll(() => setSharedTeamPlanGate(true));
  test.afterAll(() => setSharedTeamPlanGate(false));

  test('lists the plan as a checklist, each ticket with its timer, and keeps up with switches', async ({
    page,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    // The shared team is the one with the plan gate on.
    await selectSharedTestTeam(page);
    const clock = new ClockPage(page);
    // An earlier spec can leave a plain session open. Its Clock out leads to
    // the plan composer here, not the bare Clock in ensureClockedOut waits for.
    await clock.goto();
    if (await clock.clockOutButton.isVisible().catch(() => false)) {
      await clock.clockOutButton.click();
    } else {
      await clock.ensureClockedOut();
    }
    await expect(clock.banner).toContainText(/Clocked out/i);

    const stamp = Date.now();
    // One word each: the `#` list matches up to the first space.
    const alpha = `E2EPlanAlpha${stamp}`;
    const bravo = `E2EPlanBravo${stamp}`;
    const tickets = new TicketsPage(page);
    await tickets.goto();
    await tickets.createTicket(alpha);
    await tickets.createTicket(bravo);

    // Plan with both tickets, picked with `#`, then clock in.
    await clock.goto();
    await clock.typePlan('Today');
    for (const title of [alpha, bravo]) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(`#${title}`, { delay: 10 });
      await page.getByRole('option', { name: new RegExp(title) }).click();
    }
    await clock.postPlanAndClockIn();

    const plan = page.locator('.today-plan');
    const boxes = plan.getByRole('checkbox');
    await expect(boxes).toHaveCount(2);
    await expect(plan.getByText('0 of 2 done')).toBeVisible();
    // Read-only, with no toolbar and nothing to edit the plan with.
    await expect(plan.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await expect(plan.getByRole('button', { name: /Edit plan|Toggle bold/ })).toHaveCount(0);

    const start = (title: string) =>
      plan.getByRole('button', { name: new RegExp(`^Start timer for .*${title}`) });
    const stop = (title: string) =>
      plan.getByRole('button', { name: new RegExp(`^Stop timer for .*${title}`) });

    // Start Alpha from its line: its running time shows under the button.
    await start(alpha).click();
    await expect(stop(alpha)).toBeVisible();
    await expect(plan.locator('.timer-control-time')).toHaveCount(1);

    // Switch to Bravo: Alpha is checked off (touch and go).
    await start(bravo).click();
    await expect(stop(bravo)).toBeVisible();
    await expect(boxes.nth(0)).toBeChecked();
    await expect(plan.getByText('1 of 2 done')).toBeVisible();

    // A tick by hand saves at once.
    await boxes.nth(1).check();
    await expect(plan.getByText('2 of 2 done')).toBeVisible();
    await page.reload();
    await expect(page.locator('.today-plan').getByText('2 of 2 done')).toBeVisible();

    // Leave nothing running for the next spec.
    await page
      .locator('.today-plan')
      .getByRole('button', { name: /^Stop timer for / })
      .click();
    await clock.ensureClockedOut();
  });
});
