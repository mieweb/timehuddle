/**
 * Today's plan while clocked in (M4, #886): Clock in with a plan turns the
 * plan, in the same editor it was written in, into a checklist — each ticket
 * a line with its timer button in front of it and the running time under the
 * button. Ticks and switches are saved at once (touch and go).
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

    // The same editor, now the wrap-up composer, holds the plan as a checklist.
    const plan = page.locator('.clock-plan-composer');
    const boxes = plan.getByRole('checkbox');
    await expect(boxes).toHaveCount(2);
    await expect(plan.locator('.ProseMirror')).toContainText('Today');
    await expect(page.locator('.today-plan')).toHaveCount(0);

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
    await expect(boxes.nth(1)).not.toBeChecked();

    // A tick by hand saves at once, and survives a reload.
    await boxes.nth(1).check();
    await expect(boxes.nth(1)).toBeChecked();
    await page.reload();
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();

    // Leave nothing running for the next spec.
    await plan.getByRole('button', { name: /^Stop timer for / }).click();
    await clock.ensureClockedOut();
  });
});
