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
    const issueUrl = 'https://github.com/microsoft/vscode/issues/1';
    const mockTitle = 'E2E mock GitHub issue title';

    // Avoid flaky CI failures from GitHub API rate limits / network
    await page.route('**/repos/microsoft/vscode/issues/1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: mockTitle }),
      });
    });

    await page.getByRole('button', { name: 'New Ticket' }).click();

    // Paste a well-known public GitHub issue URL into the title input
    await pasteInto(page, 'Ticket title', issueUrl);

    const titleInput = page.getByPlaceholder('Ticket title');
    const urlInput = page.getByPlaceholder('GitHub URL (optional)');

    // Title should be auto-populated (not the raw URL)
    await expect(titleInput).toHaveValue(mockTitle, { timeout: 10000 });
    await expect(titleInput).not.toHaveValue(/github\.com/);

    // URL field should hold the pasted URL
    await expect(urlInput).toHaveValue(issueUrl);

    // Create the ticket
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText(mockTitle).first()).toBeVisible();

    // Cleanup
    await deleteTicket(page, mockTitle);
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
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1000);

    // Updated title should be visible
    await expect(page.getByText('Updated ticket title').first()).toBeVisible();

    // Priority pill (amber = high) should be present on the row
    const updatedRow = page.locator('li').filter({ hasText: 'Updated ticket title' }).first();
    await expect(updatedRow.filter({ hasText: 'high' })).toBeVisible();

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
    await expect(updatedRow.getByText('In Progress').first()).toBeVisible();

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

    // Ticket is visible in the default Open view
    await expect(page.getByText('Open filter ticket').first()).toBeVisible();

    // "Open" tab — should show it
    await page.getByRole('tab', { name: /Open/ }).click();
    await expect(page.getByText('Open filter ticket').first()).toBeVisible();

    // "Closed" tab — should NOT show it
    await page.getByRole('tab', { name: /Closed/ }).click();
    await expect(page.getByText('Open filter ticket')).not.toBeVisible();

    // Back to "Open"
    await page.getByRole('tab', { name: /Open/ }).click();
    await expect(page.getByText('Open filter ticket').first()).toBeVisible();

    // Cleanup
    await deleteTicket(page, 'Open filter ticket');
  });

  // ── Ticket Details ─────────────────────────────────────────────────────────

  test('view ticket details page', async ({ page }) => {
    // Create a ticket
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill('Details modal ticket');
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await page.waitForTimeout(1000);

    // Click the ticket title to navigate to the detail page
    await page.getByRole('button', { name: 'Details modal ticket' }).first().click();
    await page.waitForTimeout(600);

    // Detail page should show the ticket title as a heading
    await expect(page.getByRole('heading', { name: 'Details modal ticket' })).toBeVisible();

    // Navigate back
    await page.getByRole('button', { name: 'Back to tickets' }).click();
    await page.waitForTimeout(300);

    // Cleanup
    await deleteTicket(page, 'Details modal ticket');
  });

  // ── Command Palette ──────────────────────────────────────────────────────────

  test('create a ticket via command palette with GitHub URL', async ({ page }) => {
    const issueUrl = 'https://github.com/microsoft/vscode/issues/1';
    const mockTitle = 'E2E Command Palette GitHub Issue';
    const mockBody = 'This is the issue description from GitHub.';

    // Mock the GitHub API
    await page.route('**/repos/microsoft/vscode/issues/1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: mockTitle, body: mockBody }),
      });
    });

    // Open command palette with Cmd+K (Mac) or Ctrl+K (Windows/Linux)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+k`);

    // Command palette should be visible
    const paletteInput = page.getByPlaceholder('Type a command, search, or paste a GitHub URL...');
    await expect(paletteInput).toBeVisible({ timeout: 5000 });

    // Paste the GitHub URL
    await paletteInput.fill(issueUrl);

    // Wait for the green preview panel to appear with the title
    await expect(page.getByText('GitHub issue identified')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(mockTitle)).toBeVisible();

    // Description preview should be visible
    await expect(page.getByText(mockBody, { exact: false })).toBeVisible();

    // Press Enter to create the ticket
    await page.keyboard.press('Enter');

    // Should navigate to tickets page
    await page.waitForURL('**/tickets', { timeout: 10000 });

    // The ticket should appear in the list
    await expect(page.getByText(mockTitle).first()).toBeVisible({ timeout: 10000 });

    // Cleanup
    await deleteTicket(page, mockTitle);
  });
});
