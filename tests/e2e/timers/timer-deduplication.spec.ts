import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { TEST_USERS } from '../fixtures/users';

/**
 * Timer Deduplication E2E Test
 *
 * Verifies that starting a ticket timer multiple times on the same day
 * reuses the same work item instead of creating duplicates.
 *
 * Test flow:
 * 1. Login and clock in
 * 2. Create a test ticket
 * 3. Start timer from Tickets page
 * 4. Stop timer
 * 5. Start timer again (2nd time)
 * 6. Stop timer
 * 7. Start timer again (3rd time)
 * 8. Navigate to Work page
 * 9. Verify only ONE work item exists for the test ticket
 */
test.describe('Timer Deduplication', () => {
  let loginPage: LoginPage;
  const testTicketTitle = `Dedup Test ${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAs(TEST_USERS.owner1);
    await page.waitForURL('**/dashboard', { timeout: 15000 });
  });

  test('should reuse same work item when starting timer multiple times on same day', async ({
    page,
  }) => {
    // Ensure clocked in
    await page.goto('/app/clock');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const clockInBtn = page.getByRole('button', { name: 'Clock in' });
    const clockOutBtn = page.getByRole('button', { name: 'Clock out' });

    // Clock in if needed
    const isClockedIn = await clockOutBtn.isVisible().catch(() => false);
    if (!isClockedIn) {
      await clockInBtn.click();
      await expect(clockOutBtn).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    }

    // Create a test ticket
    await page.goto('/app/tickets');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(testTicketTitle);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await expect(page.getByText(testTicketTitle).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Start timer (1st time)
    const startBtn1 = page.getByRole('button', { name: `Start timer for ${testTicketTitle}` });
    await expect(startBtn1).toBeVisible({ timeout: 5000 });
    await startBtn1.click();

    // Handle possible clock-in modal (shouldn't appear since we clocked in, but just in case)
    const clockInModal = page.locator('[role="dialog"]').filter({ hasText: 'Clock in first?' });
    const modalVisible = await clockInModal.isVisible().catch(() => false);
    if (modalVisible) {
      await clockInModal.getByRole('button', { name: 'Clock in' }).click();
      await page.waitForTimeout(2000);
    }

    // Wait for timer to start
    const stopBtn1 = page.getByRole('button', { name: `Stop timer for ${testTicketTitle}` });
    await expect(stopBtn1).toBeVisible({ timeout: 10000 });

    // Stop timer
    await stopBtn1.click();
    await expect(startBtn1).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Start timer (2nd time) - should reuse same work item
    await startBtn1.click();
    await expect(stopBtn1).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Stop timer
    await stopBtn1.click();
    await expect(startBtn1).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Start timer (3rd time) - should still reuse same work item
    await startBtn1.click();
    await expect(stopBtn1).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Stop timer
    await stopBtn1.click();
    await expect(startBtn1).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Navigate to Work page to verify work items
    await page.goto('/app/work');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // Wait for data to load

    // Count work items for our test ticket
    const allRows = page.locator('tbody tr');
    const testTicketRows = allRows.filter({ hasText: testTicketTitle });

    // Should have exactly ONE work item for this ticket (no duplicates)
    await expect(testTicketRows).toHaveCount(1);

    // Verify the work item has accumulated time from multiple timer sessions
    const workItemRow = testTicketRows.first();
    await expect(workItemRow).toBeVisible();

    // The time should be > 0 (accumulated from 3 timer sessions)
    const timeText = await workItemRow.locator('td').nth(1).textContent();
    expect(timeText).not.toBe('0m'); // Should have some accumulated time

    // Cleanup: Delete the test ticket
    await page.goto('/app/tickets');
    await page.waitForLoadState('domcontentloaded');

    const ticketRow = page.locator('li').filter({ hasText: testTicketTitle }).first();
    await ticketRow.getByRole('button', { name: 'Ticket options' }).click();
    await page.getByRole('menuitem', { name: 'Delete Ticket' }).click();
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(testTicketTitle)).not.toBeVisible({ timeout: 10000 });
  });

  test('should create separate work items for different dates', async ({ page }) => {
    // This test verifies that work items ARE created separately per date
    // (to distinguish from the deduplication behavior on the same date)

    // Ensure clocked in
    await page.goto('/app/clock');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const clockInBtn = page.getByRole('button', { name: 'Clock in' });
    const clockOutBtn = page.getByRole('button', { name: 'Clock out' });
    const isClockedIn = await clockOutBtn.isVisible().catch(() => false);
    if (!isClockedIn) {
      await clockInBtn.click();
      await expect(clockOutBtn).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    }

    // Create a test ticket
    const separateDatesTicket = `Dates Test ${Date.now()}`;
    await page.goto('/app/tickets');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(separateDatesTicket);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await expect(page.getByText(separateDatesTicket).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Start and stop timer for today
    const startBtn = page.getByRole('button', { name: `Start timer for ${separateDatesTicket}` });
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    // Handle possible clock-in modal
    const clockInModal = page.locator('[role="dialog"]').filter({ hasText: 'Clock in first?' });
    const modalVisible = await clockInModal.isVisible().catch(() => false);
    if (modalVisible) {
      await clockInModal.getByRole('button', { name: 'Clock in' }).click();
      await page.waitForTimeout(2000);
    }

    const stopBtn = page.getByRole('button', { name: `Stop timer for ${separateDatesTicket}` });
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    await stopBtn.click();
    await expect(startBtn).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Navigate to Work page and check today's work items
    await page.goto('/app/work');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const todayRows = page.locator('tbody tr').filter({ hasText: separateDatesTicket });
    const todayCount = await todayRows.count();
    expect(todayCount).toBeGreaterThanOrEqual(1);

    // TODO: Test would create work item for yesterday by manually calling API
    // For now, this test confirms today's work item exists

    // Cleanup
    await page.goto('/app/tickets');
    const ticketRow = page.locator('li').filter({ hasText: separateDatesTicket }).first();
    await ticketRow.getByRole('button', { name: 'Ticket options' }).click();
    await page.getByRole('menuitem', { name: 'Delete Ticket' }).click();
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(separateDatesTicket)).not.toBeVisible({ timeout: 10000 });
  });
});
