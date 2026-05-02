import { expect, test } from '@playwright/test';

const TEST_EMAIL = 'alice@example.com';
const TEST_PASSWORD = 'Password1!';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: import('@playwright/test').Page) {
  await page.goto('/app');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // App navigates to /app/dashboard on successful login
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

async function goToTickets(page: import('@playwright/test').Page) {
  await page.goto('/app/tickets');
  // Wait for the desktop "New Ticket" button to confirm auth + page are ready
  await page.waitForSelector('button:has-text("New Ticket")', { timeout: 15000 });
}

/** Simulate a clipboard paste event on an input by placeholder text. */
async function pasteInto(page: import('@playwright/test').Page, placeholder: string, text: string) {
  const input = page.getByPlaceholder(placeholder);
  await input.click();
  await input.evaluate((el, value) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, text);
}

/**
 * Open the 3-dot dropdown menu for the ticket row with the given title.
 * Dropdown items use role="menuitem".
 */
async function openTicketMenu(page: import('@playwright/test').Page, title: string) {
  const row = page.locator('li').filter({ hasText: title }).first();
  await row.getByRole('button', { name: 'Ticket options' }).click();
  await page.waitForTimeout(200);
}

async function deleteTicket(page: import('@playwright/test').Page, title: string) {
  await openTicketMenu(page, title);
  await page.getByRole('menuitem', { name: 'Delete Ticket' }).click();
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(800);
}

// ─── Tickets E2E ──────────────────────────────────────────────────────────────

test.describe('Tickets', () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await login(page);
    await goToTickets(page);
  });

  // ── Create ─────────────────────────────────────────────────────────────────

  test('create a ticket with a manual title', async ({ page }) => {
    await page.getByRole('button', { name: 'New Ticket' }).click();

    const titleInput = page.getByPlaceholder('Ticket title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('My e2e test ticket');

    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('My e2e test ticket').first()).toBeVisible();

    // Cleanup
    await deleteTicket(page, 'My e2e test ticket');
  });

  test('create a ticket by pasting GitHub PR URL into title field', async ({ page }) => {
    await page.getByRole('button', { name: 'New Ticket' }).click();

    // Paste a well-known public GitHub issue URL into the title input
    await pasteInto(page, 'Ticket title', 'https://github.com/microsoft/vscode/issues/1');

    // Wait for the GitHub API fetch to resolve
    await page.waitForTimeout(5000);

    const titleInput = page.getByPlaceholder('Ticket title');
    const urlInput = page.getByPlaceholder('GitHub / Redmine URL (optional)');

    // Title should be auto-populated (not the raw URL)
    const titleValue = await titleInput.inputValue();
    expect(titleValue.length).toBeGreaterThan(0);
    expect(titleValue).not.toContain('github.com');

    // URL field should hold the pasted URL
    await expect(urlInput).toHaveValue('https://github.com/microsoft/vscode/issues/1');

    // Create the ticket
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText(titleValue).first()).toBeVisible();

    // Cleanup
    await deleteTicket(page, titleValue);
  });

  // ── Edit ───────────────────────────────────────────────────────────────────

  test('edit ticket title and priority', async ({ page }) => {
    // Create a ticket first
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill('Ticket to edit');
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    // Open Edit Ticket from the 3-dot menu (items use role="menuitem")
    await openTicketMenu(page, 'Ticket to edit');
    await page.getByRole('menuitem', { name: 'Edit Ticket' }).click();
    await page.waitForTimeout(400);

    // Edit the title
    const titleField = page.getByLabel('Title');
    await titleField.clear();
    await titleField.fill('Updated ticket title');

    // Set priority — click the Priority combobox within the dialog
    await page.locator('[role="dialog"]').getByRole('combobox', { name: 'Priority' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('option', { name: 'High' }).click();
    await page.waitForTimeout(200);

    // Save
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForTimeout(1000);

    // Updated title should be visible
    await expect(page.getByText('Updated ticket title').first()).toBeVisible();

    // Priority dot (amber = high) should be present on the row
    const updatedRow = page.locator('li').filter({ hasText: 'Updated ticket title' });
    await expect(updatedRow.locator('.bg-amber-500')).toBeVisible();

    // Cleanup
    await deleteTicket(page, 'Updated ticket title');
  });

  test('change ticket status via Change Status modal', async ({ page }) => {
    // Create a ticket first
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill('Status test ticket');
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    // Open Change Status from the 3-dot menu
    await openTicketMenu(page, 'Status test ticket');
    await page.getByRole('menuitem', { name: 'Change Status' }).click();
    await page.waitForTimeout(400);

    // Modal should appear
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Select "In Progress" from the combobox
    await page.locator('[role="dialog"]').getByRole('combobox').click();
    await page.waitForTimeout(200);
    await page.getByRole('option', { name: 'In Progress' }).click();
    await page.waitForTimeout(200);

    await page.locator('[role="dialog"]').getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1000);

    // The status badge on the row should update
    const updatedRow = page.locator('li').filter({ hasText: 'Status test ticket' });
    await expect(updatedRow.getByText('In Progress')).toBeVisible();

    // Cleanup
    await deleteTicket(page, 'Status test ticket');
  });

  // ── Delete ─────────────────────────────────────────────────────────────────

  test('delete a ticket', async ({ page }) => {
    // Create a ticket first
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill('Ticket to delete');
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('Ticket to delete').first()).toBeVisible();

    await deleteTicket(page, 'Ticket to delete');

    await expect(page.getByText('Ticket to delete')).not.toBeVisible();
  });

  // ── Filter tabs ────────────────────────────────────────────────────────────

  test('filter tabs show correct tickets', async ({ page }) => {
    // Create an open ticket
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill('Open filter ticket');
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    // "All" tab — ticket should be visible
    await expect(page.getByText('Open filter ticket').first()).toBeVisible();

    // "Open" tab — should show it
    await page.getByRole('tab', { name: 'Open' }).click();
    await expect(page.getByText('Open filter ticket').first()).toBeVisible();

    // "Done" tab — should NOT show it
    await page.getByRole('tab', { name: 'Done' }).click();
    await expect(page.getByText('Open filter ticket')).not.toBeVisible();

    // Back to "All"
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(page.getByText('Open filter ticket').first()).toBeVisible();

    // Cleanup
    await deleteTicket(page, 'Open filter ticket');
  });

  // ── Ticket Details ─────────────────────────────────────────────────────────

  test('view ticket details modal', async ({ page }) => {
    // Create a ticket
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill('Details modal ticket');
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    // Open 3-dot menu → Ticket Details
    await openTicketMenu(page, 'Details modal ticket');
    await page.getByRole('menuitem', { name: 'Ticket Details' }).click();
    await page.waitForTimeout(400);

    // Details modal should show the ticket title
    await expect(page.locator('[role="dialog"]').getByText('Details modal ticket')).toBeVisible();

    await page.locator('[role="dialog"]').getByText('Close').click();
    await page.waitForTimeout(300);

    // Cleanup
    await deleteTicket(page, 'Details modal ticket');
  });
});
