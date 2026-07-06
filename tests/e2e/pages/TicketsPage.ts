import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * TicketsPage - Page object for ticket management
 */
export class TicketsPage extends BasePage {
  readonly heading: Locator;
  readonly newTicketButton: Locator;
  readonly searchInput: Locator;
  readonly openTab: Locator;
  readonly closedTab: Locator;
  readonly priorityFilter: Locator;
  readonly statusFilter: Locator;
  readonly assigneeFilter: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { level: 1, name: /Tickets/i });
    this.newTicketButton = this.page.getByRole('button', { name: 'New Ticket' });
    this.searchInput = this.page.getByPlaceholder('Search tickets…');
    this.openTab = this.page.getByRole('tab', { name: /Open/i });
    this.closedTab = this.page.getByRole('tab', { name: /Closed/i });
    this.priorityFilter = this.page.getByRole('button', { name: 'Priority' });
    this.statusFilter = this.page.getByRole('button', { name: 'Status' });
    this.assigneeFilter = this.page.getByRole('button', { name: 'Assignee' });
  }

  async goto() {
    await this.page.goto('/app/tickets');
    await this.waitForLoad();
  }

  async waitForLoad(timeout = 10000) {
    await this.heading.waitFor({ state: 'visible', timeout });
  }

  async navigateFromSidebar() {
    await this.page.getByRole('button', { name: /^Tickets$/i }).click();
    await this.waitForLoad();
  }

  /** Open the create ticket form */
  async openCreateForm() {
    await this.newTicketButton.click();
    await this.page.getByPlaceholder('Ticket title').waitFor({ state: 'visible' });
  }

  /** Create a ticket with the given title and optional GitHub URL */
  async createTicket(title: string, githubUrl?: string) {
    await this.openCreateForm();
    await this.page.getByPlaceholder('Ticket title').fill(title);
    if (githubUrl) {
      await this.page.getByPlaceholder('GitHub URL (optional)').fill(githubUrl);
      // Wait for title fetch
      await this.page.waitForTimeout(1500);
    }
    await this.page.getByRole('button', { name: 'Create Ticket' }).click();
    // Wait for ticket to appear in the list
    await this.page.waitForTimeout(1000);
  }

  /** Search for a ticket */
  async search(query: string) {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(500);
  }

  /** Clear search */
  async clearSearch() {
    await this.searchInput.clear();
    await this.page.waitForTimeout(500);
  }

  /** Get the count of visible tickets */
  async getTicketCount(): Promise<number> {
    const items = this.page.locator('[role="article"], [data-ticket-id]');
    return await items.count();
  }

  /** Click on a ticket by title */
  async clickTicket(title: string) {
    await this.page.getByText(title, { exact: false }).first().click();
    await this.page.waitForTimeout(500);
  }

  /** Check if a ticket is visible */
  async isTicketVisible(title: string): Promise<boolean> {
    return await this.page
      .getByText(title, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
  }

  /** Open the ticket action menu for a ticket */
  async openTicketMenu(title: string) {
    // Find the ticket row containing the title and click its menu button
    const ticketRow = this.page.locator(`text=${title}`).first().locator('..');
    const menuBtn = ticketRow
      .locator('button')
      .filter({ has: this.page.locator('[class*="ellipsis"]') });
    if ((await menuBtn.count()) > 0) {
      await menuBtn.first().click();
    }
  }

  /** Delete a ticket via the ticket detail menu */
  async deleteTicket(title: string) {
    await this.clickTicket(title);
    await this.page.waitForTimeout(500);
    // Look for the delete button/option in the details view or menu
    const deleteBtn = this.page.getByRole('button', { name: /delete/i }).first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      // Confirm deletion if dialog appears
      const confirmBtn = this.page.getByRole('button', { name: /confirm|delete|yes/i }).first();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }
      await this.page.waitForTimeout(1000);
    }
  }

  /** Switch to closed tickets tab */
  async showClosedTickets() {
    await this.closedTab.click();
    await this.page.waitForTimeout(500);
  }

  /** Switch to open tickets tab */
  async showOpenTickets() {
    await this.openTab.click();
    await this.page.waitForTimeout(500);
  }
}
