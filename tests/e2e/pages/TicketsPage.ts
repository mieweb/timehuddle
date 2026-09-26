import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * TicketsPage - Page object for the unified ticket table.
 *
 * The table shows every source (TimeHuddle, Redmine) at once — there is no view
 * switcher. Rows carry `data-ticket-source` so tests can assert on provenance.
 * Sorting and filtering both live on the column headers; a switch toggles
 * open/closed, and paging replaces scrolling.
 */
export class TicketsPage extends BasePage {
  readonly heading: Locator;
  readonly newTicketButton: Locator;
  readonly searchInput: Locator;
  readonly closedSwitch: Locator;
  readonly clearFiltersButton: Locator;
  readonly selectAllCheckbox: Locator;
  readonly pagination: Locator;
  readonly ticketsTab: Locator;
  readonly myBoardTab: Locator;
  readonly moveToBoardButton: Locator;
  readonly removeFromBoardButton: Locator;
  readonly deselectAllButton: Locator;
  readonly bulkDeleteButton: Locator;
  readonly archiveButton: Locator;
  readonly closeIssuesButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { level: 1, name: /Tickets/i });
    this.newTicketButton = this.page.getByRole('button', { name: 'New Ticket' });
    this.searchInput = this.page.getByPlaceholder('Search tickets…');
    this.closedSwitch = this.page.getByRole('switch', { name: /Closed/i });
    this.clearFiltersButton = this.page.getByRole('button', { name: 'Clear filters' });
    this.selectAllCheckbox = this.page.getByRole('checkbox', { name: /Select all tickets/i });
    this.pagination = this.page.getByRole('navigation', { name: 'Ticket pages' });
    this.ticketsTab = this.page.getByRole('tab', { name: 'Tickets' });
    this.myBoardTab = this.page.getByRole('tab', { name: 'My Board' });
    this.moveToBoardButton = this.page.getByRole('button', { name: 'Move to My Board' });
    this.removeFromBoardButton = this.page.getByRole('button', { name: 'Remove from My Board' });
    this.deselectAllButton = this.page.getByRole('button', { name: 'Deselect all' });
    this.bulkDeleteButton = this.page.getByRole('button', { name: 'Delete selected tickets' });
    this.archiveButton = this.page.getByRole('button', { name: 'Archive' });
    this.closeIssuesButton = this.page.getByRole('button', { name: 'Close Issues' });
  }

  /** Switch between the "Tickets" and "My Board" tabs (same URL). */
  async switchToTab(tab: 'tickets' | 'my-board') {
    await (tab === 'tickets' ? this.ticketsTab : this.myBoardTab).click();
    await this.page.waitForTimeout(300);
  }

  /** Check a ticket row's selection checkbox by title. */
  async selectTicket(title: string) {
    await this.rowByTitle(title).getByRole('checkbox').click();
  }

  /**
   * The ▶/⏸ button on a My Board row. My Board is the only place in the app
   * that starts a ticket timer (M3 D1), so this exists nowhere else.
   */
  timerButtonForRow(title: string): Locator {
    return this.rowByTitle(title).getByRole('button', { name: /start timer|stop timer/i });
  }

  startTimerButton(title: string): Locator {
    return this.page.getByRole('button', { name: `Start timer for ${title}` });
  }

  stopTimerButton(title: string): Locator {
    return this.page.getByRole('button', { name: `Stop timer for ${title}` });
  }

  /** Move a ticket to My Board from the Tickets tab and land on My Board. */
  async moveToBoard(title: string) {
    await this.selectTicket(title);
    await this.moveToBoardButton.click();
    await this.switchToTab('my-board');
  }

  /** The filter trigger inside a column header. */
  filterTrigger(column: string): Locator {
    return this.page
      .getByRole('columnheader', { name: new RegExp(column) })
      .getByRole('button', { name: new RegExp(`(Filter by|filtered by) ${column}`, 'i') });
  }

  /** Pick a value from a column's filter menu. */
  async filterBy(column: string, option: string) {
    await this.filterTrigger(column).click();
    await this.page.getByRole('menuitem', { name: option, exact: true }).click();
    await this.page.waitForTimeout(300);
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
    return await this.activePanel.locator('tr[data-ticket-id]').count();
  }

  /**
   * The tab panel currently on screen.
   *
   * Both panels are force-mounted so switching tabs keeps each one's search,
   * filters and selection — which means every ticket on My Board also exists as
   * a row in the hidden Tickets panel. Every row locator scopes through here so
   * it resolves to the one row the user can actually see.
   */
  get activePanel(): Locator {
    return this.page.locator('[role="tabpanel"]:visible');
  }

  /** All rows contributed by one source. */
  rowsFromSource(sourceId: 'huddle' | 'redmine'): Locator {
    return this.activePanel.locator(`tr[data-ticket-source="${sourceId}"]`);
  }

  /** The row for a given ticket title, in whichever tab is showing. */
  rowByTitle(title: string): Locator {
    return this.activePanel.locator('tr[data-ticket-id]').filter({ hasText: title });
  }

  /** Restrict the table to a single source via the Source column filter. */
  async filterBySource(label: 'TimeHuddle' | 'Redmine') {
    await this.filterBy('Source', label);
  }

  /** Click a sortable column header to sort by it. */
  async sortByColumn(header: string) {
    await this.page
      .getByRole('columnheader', { name: new RegExp(header) })
      .getByRole('button', { name: new RegExp(`Sort by ${header}`, 'i') })
      .click();
    await this.page.waitForTimeout(300);
  }

  /** Current aria-sort value of a column header. */
  async sortStateOf(header: string): Promise<string | null> {
    return await this.page
      .getByRole('columnheader', { name: new RegExp(header) })
      .getAttribute('aria-sort');
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

  /** Switch to closed tickets */
  async showClosedTickets() {
    await this.closedSwitch.click();
    await this.page.waitForTimeout(500);
  }

  /** Switch back to open tickets */
  async showOpenTickets() {
    if (await this.closedSwitch.isChecked()) {
      await this.closedSwitch.click();
      await this.page.waitForTimeout(500);
    }
  }
}
