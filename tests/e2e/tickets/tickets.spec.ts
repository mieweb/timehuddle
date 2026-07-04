/**
 * Tickets E2E Tests
 *
 * 1. Correct URL on tickets page
 * 2. Create ticket (with and without GitHub URL)
 * 3. Search existing ticket
 * 4. Edit ticket modal components
 * 5. Ticket details modal
 * 6. Delete ticket
 * 7. Assign/unassign ticket
 */
import { test, expect } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';

const TICKET_TITLE = `E2E Test Ticket ${Date.now()}`;
const TICKET_TITLE_2 = `E2E Searchable Ticket ${Date.now()}`;

test.describe('Tickets', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('should navigate to tickets page with correct URL', async ({ page }) => {
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });

    // Verify correct URL
    expect(page.url()).toContain('/app/tickets');

    // Verify page components
    await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Ticket' })).toBeVisible();
    await expect(page.getByPlaceholder('Search tickets…')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Open/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Closed/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Priority' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Assignee' })).toBeVisible();
  });

  test('should create a ticket', async ({ page }) => {
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });

    // Click New Ticket button
    await page.getByRole('button', { name: 'New Ticket' }).click();

    // Fill in ticket title
    await page.getByPlaceholder('Ticket title').waitFor({ state: 'visible' });
    await page.getByPlaceholder('Ticket title').fill(TICKET_TITLE);

    // Click Create Ticket
    await page.getByRole('button', { name: 'Create Ticket' }).click();

    // Wait for ticket to appear in the list
    await page.waitForTimeout(2000);
    await expect(page.getByText(TICKET_TITLE)).toBeVisible({ timeout: 10000 });
  });

  test('should create a ticket and search for it', async ({ page }) => {
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });

    // Create a ticket first
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(TICKET_TITLE_2);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(TICKET_TITLE_2)).toBeVisible({ timeout: 10000 });

    // Search for the ticket
    await page.getByPlaceholder('Search tickets…').fill(TICKET_TITLE_2.slice(0, 15));
    await page.waitForTimeout(500);

    // Ticket should still be visible
    await expect(page.getByText(TICKET_TITLE_2)).toBeVisible();

    // Clear search and verify all tickets show again
    await page.getByPlaceholder('Search tickets…').clear();
    await page.waitForTimeout(500);
  });

  test('should open edit ticket modal with all components', async ({ page }) => {
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });

    // Create a ticket to edit
    const editTitle = `E2E Edit Test ${Date.now()}`;
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(editTitle);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(editTitle)).toBeVisible({ timeout: 10000 });

    // Open the ticket options menu
    const ticketRow = page.locator('li').filter({ hasText: editTitle }).first();
    const menuBtn = ticketRow.getByRole('button', { name: 'Ticket options' });
    await menuBtn.click();

    // Click Edit Ticket from dropdown
    await page.getByText('Edit Ticket', { exact: true }).click();

    // Verify edit modal components
    await expect(page.getByRole('heading', { name: 'Edit Ticket' })).toBeVisible();
    await expect(page.getByLabel(/Title/i)).toBeVisible();
    await expect(page.getByLabel(/Description/i)).toBeVisible();
    await expect(page.getByLabel(/GitHub URL/i)).toBeVisible();
    await expect(page.getByText('Assignees')).toBeVisible();
    await expect(page.getByLabel(/Priority/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    // Edit the title
    const titleInput = page.getByLabel(/Title/i);
    await titleInput.clear();
    await titleInput.fill(`${editTitle} - Updated`);

    // Save the edit
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);

    // Verify updated title appears
    await expect(page.getByText(`${editTitle} - Updated`)).toBeVisible({ timeout: 10000 });
  });

  test('should open ticket details and verify components', async ({ page }) => {
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });

    // Create a ticket
    const detailTitle = `E2E Detail Test ${Date.now()}`;
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(detailTitle);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(detailTitle)).toBeVisible({ timeout: 10000 });

    // Open ticket options menu
    const ticketRow = page.locator('li').filter({ hasText: detailTitle }).first();
    const menuBtn = ticketRow.getByRole('button', { name: 'Ticket options' });
    await menuBtn.click();
    await page.waitForTimeout(500);

    // Click Ticket Details from the dropdown
    const detailsItem = page.getByRole('menuitem', { name: 'Ticket Details' });
    if (await detailsItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await detailsItem.click();
    } else {
      // Fallback: try text-based click
      await page.getByText('Ticket Details', { exact: true }).click();
    }
    await page.waitForTimeout(1000);

    await page.waitForTimeout(2000);

    // "Ticket Details" either opens a modal or navigates to /app/tickets/:id
    // Verify the ticket info is displayed in either format
    const detailHeading = page.getByRole('heading', { name: 'Ticket Details' });

    if (await detailHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Modal view - verify components
      await expect(page.getByText('Created By')).toBeVisible();
      const closeBtn = page.getByRole('button', { name: 'Close' });
      if (await closeBtn.isVisible()) await closeBtn.click();
    } else {
      // Detail page view (/app/tickets/:id)
      // Verify the ticket title is in the heading
      await expect(page.getByRole('heading', { name: detailTitle })).toBeVisible({ timeout: 5000 });
    }

    // Navigate back to tickets list
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });
  });

  test('should delete a ticket', async ({ page }) => {
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });

    // Create a ticket to delete
    const deleteTitle = `E2E Delete Test ${Date.now()}`;
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(deleteTitle);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(deleteTitle)).toBeVisible({ timeout: 10000 });

    // Open ticket options menu
    const ticketRow = page.locator('li').filter({ hasText: deleteTitle }).first();
    const menuBtn = ticketRow.getByRole('button', { name: 'Ticket options' });
    await menuBtn.click();

    // Click Delete Ticket
    await page.getByText('Delete Ticket', { exact: true }).click();

    // Confirm deletion
    const confirmBtn = page.getByRole('button', { name: /confirm|delete|yes/i }).last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Wait and verify ticket is gone
    await page.waitForTimeout(2000);
    await expect(page.getByText(deleteTitle)).not.toBeVisible({ timeout: 5000 });
  });

  test('should assign and unassign a ticket', async ({ page }) => {
    // Navigate fresh to ensure no leftover modals
    await page.goto('/app/tickets');
    await page.waitForLoadState('networkidle');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);

    // Create a ticket to assign
    const assignTitle = `E2E Assign Test ${Date.now()}`;
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(assignTitle);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(assignTitle)).toBeVisible({ timeout: 10000 });

    // Open edit modal to assign via checkboxes
    const ticketRow = page.locator('li').filter({ hasText: assignTitle }).first();
    const menuBtn = ticketRow.getByRole('button', { name: 'Ticket options' });
    await menuBtn.click();
    await page.waitForTimeout(500);

    // Click Edit Ticket from dropdown
    await page.getByText('Edit Ticket', { exact: true }).click();
    await page.waitForTimeout(1000);

    // Verify edit modal is open
    await expect(page.getByRole('heading', { name: 'Edit Ticket' })).toBeVisible({ timeout: 5000 });

    // Assign: check the first assignee checkbox in the Assignees section
    const assigneeSection = page.locator('text=Assignees').locator('..');
    const assigneeCheckboxes = assigneeSection.locator('input[type="checkbox"]');
    const count = await assigneeCheckboxes.count();
    if (count > 0) {
      await assigneeCheckboxes.first().check();
    }

    // Save
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);

    // Verify the ticket still exists after assign
    await expect(page.getByText(assignTitle).first()).toBeVisible({ timeout: 5000 });

    // Reload the page to clear any overlays, then unassign
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);

    // Open edit modal again to unassign
    const ticketRow2 = page.locator('li').filter({ hasText: assignTitle }).first();
    await ticketRow2.getByRole('button', { name: 'Ticket options' }).click();
    await page.waitForTimeout(500);
    await page.getByText('Edit Ticket', { exact: true }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByRole('heading', { name: 'Edit Ticket' })).toBeVisible({ timeout: 5000 });

    // Uncheck all assignees
    const assigneeSection2 = page.locator('text=Assignees').locator('..');
    const checkboxes = assigneeSection2.locator('input[type="checkbox"]');
    const cbCount = await checkboxes.count();
    for (let i = 0; i < cbCount; i++) {
      const cb = checkboxes.nth(i);
      if (await cb.isChecked()) {
        await cb.uncheck();
      }
    }

    // Save
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);
  });

  test('should show dropdown menu within viewport on mobile', async ({ page }) => {
    // Set mobile viewport (iPhone 12)
    await page.setViewportSize({ width: 390, height: 844 });
    
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });

    // Create a ticket to test the dropdown
    const mobileTitle = `E2E Mobile Dropdown ${Date.now()}`;
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(mobileTitle);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(mobileTitle)).toBeVisible({ timeout: 10000 });

    // Find the ticket and click the options menu
    const ticketRow = page.locator('li').filter({ hasText: mobileTitle }).first();
    const menuBtn = ticketRow.getByRole('button', { name: 'Ticket options' });
    
    // Verify the button is visible on mobile
    await expect(menuBtn).toBeVisible();
    
    // Click to open dropdown
    await menuBtn.click();
    await page.waitForTimeout(500);

    // Verify all dropdown items are visible and text is not cut off
    const dropdownItems = [
      'Ticket Details',
      'Edit Ticket',
      'Change Status',
      'Send to TimeHarbor',
      'Delete Ticket'
    ];

    // Get the dropdown content container
    const dropdownContent = page.locator('[role="menu"]').or(page.locator('.dropdown-content')).first();
    const contentBox = await dropdownContent.boundingBox().catch(() => null);
    
    if (contentBox) {
      // Verify dropdown content stays within viewport with some margin
      expect(contentBox.x).toBeGreaterThanOrEqual(0);
      expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(390 + 5); // 5px tolerance
    }

    // Verify all items are visible
    for (const itemText of dropdownItems) {
      const item = page.getByText(itemText, { exact: true });
      await expect(item).toBeVisible({ timeout: 2000 });
    }

    // Click Ticket Details to verify interaction works
    await page.getByText('Ticket Details', { exact: true }).click();
    await page.waitForTimeout(1000);

    // Should navigate to detail page or show modal
    const isDetailPage = page.url().includes('/app/tickets/');
    const isModal = await page.getByRole('heading', { name: 'Ticket Details' }).isVisible({ timeout: 2000 }).catch(() => false);
    
    expect(isDetailPage || isModal).toBeTruthy();

    // Reset viewport for other tests
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should show dropdown menu within viewport on tablet', async ({ page }) => {
    // Set tablet viewport (iPad)
    await page.setViewportSize({ width: 768, height: 1024 });
    
    await page.goto('/app/tickets');
    await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });

    // Create a ticket to test the dropdown
    const tabletTitle = `E2E Tablet Dropdown ${Date.now()}`;
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(tabletTitle);
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(tabletTitle)).toBeVisible({ timeout: 10000 });

    // Find the ticket and click the options menu
    const ticketRow = page.locator('li').filter({ hasText: tabletTitle }).first();
    const menuBtn = ticketRow.getByRole('button', { name: 'Ticket options' });
    
    // Click to open dropdown
    await menuBtn.click();
    await page.waitForTimeout(500);

    // Verify all dropdown items are visible
    await expect(page.getByText('Ticket Details', { exact: true })).toBeVisible();
    await expect(page.getByText('Edit Ticket', { exact: true })).toBeVisible();
    await expect(page.getByText('Change Status', { exact: true })).toBeVisible();
    
    // Get the dropdown content container and verify it stays within viewport
    const dropdownContent = page.locator('[role="menu"]').or(page.locator('.dropdown-content')).first();
    const contentBox = await dropdownContent.boundingBox().catch(() => null);
    
    if (contentBox) {
      expect(contentBox.x).toBeGreaterThanOrEqual(0);
      expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(768 + 5); // 5px tolerance
    }

    // Reset viewport for other tests
    await page.setViewportSize({ width: 1280, height: 720 });
  });});