import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * TicketsPage - Page object for the unified ticket list.
 *
 * The page has two views over the same list, chosen with a switcher: My Board, which it opens on, and
 * All Sources, which shows every source (TimeHuddle, Redmine) at once. Rows
 * carry `data-ticket-source` so tests can assert on provenance. Every sort and
 * filter is in one "Sort and filter" menu in the list header, beside the
 * Open/Closed switcher; the rows scroll under that header.
 *
 * `goto()` lands on All Sources, because that is the table most specs are
 * about; a spec about the board switches with `switchToTab('my-board')`, and
 * one about the page's own default uses `page.goto('/app/tickets')`.
 */
export class TicketsPage extends BasePage {
  readonly heading: Locator;
  readonly newTicketButton: Locator;
  readonly searchInput: Locator;
  readonly openSwitch: Locator;
  readonly closedSwitch: Locator;
  readonly sortFilterButton: Locator;
  readonly clearFiltersButton: Locator;
  readonly selectAllCheckbox: Locator;
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
    // One input with two jobs since Redmine MVP2: it filters the table and opens
    // the Redmine suggestion dropdown, so it is a combobox.
    this.searchInput = this.page.getByRole('combobox', {
      name: 'Search tickets and Redmine issues',
    });
    // Open/Closed is a radio pair in the list header, labelled with its counts.
    this.openSwitch = this.page.getByRole('radio', { name: /Open$/ });
    this.closedSwitch = this.page.getByRole('radio', { name: /Closed$/ });
    this.sortFilterButton = this.page.getByRole('button', { name: /^Sort and filter/ });
    this.clearFiltersButton = this.page.getByRole('button', { name: 'Clear filters' });
    this.selectAllCheckbox = this.page.getByRole('checkbox', { name: /Select all tickets/i });
    this.ticketsTab = this.page.getByRole('radio', { name: 'All Sources' });
    this.myBoardTab = this.page.getByRole('radio', { name: 'My Board' });
    this.moveToBoardButton = this.page.getByRole('button', { name: 'Move to My Board' });
    this.removeFromBoardButton = this.page.getByRole('button', { name: 'Remove from My Board' });
    this.deselectAllButton = this.page.getByRole('button', { name: 'Deselect all' });
    this.bulkDeleteButton = this.page.getByRole('button', { name: 'Delete selected tickets' });
    this.archiveButton = this.page.getByRole('button', { name: 'Archive' });
    this.closeIssuesButton = this.page.getByRole('button', { name: 'Close Issues' });
  }

  /** Switch between the All Sources (`tickets`) and My Board tabs (same URL). */
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

  /** Move a ticket to My Board from All Sources and land on My Board. */
  async moveToBoard(title: string) {
    await this.selectTicket(title);
    await this.moveToBoardButton.click();
    await this.switchToTab('my-board');
  }

  /** One field's filter section in the open sort-and-filter menu. */
  filterSection(field: string): Locator {
    return this.page
      .getByRole('menu')
      .getByRole('group', { name: new RegExp(`^Filter by ${field}`) });
  }

  /** Pick a value from a field's section of the sort-and-filter menu. */
  async filterBy(field: string, option: string) {
    await this.sortFilterButton.click();
    await this.filterSection(field).getByRole('menuitem', { name: option, exact: true }).click();
    await this.page.waitForTimeout(300);
  }

  async goto() {
    await this.page.goto('/app/tickets');
    await this.waitForLoad();
  }

  /** Wait for the page, then show All Sources (see the note on this class). */
  async waitForLoad(timeout = 10000) {
    await this.heading.waitFor({ state: 'visible', timeout });
    await this.ticketsTab.click();
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

  /** Create a ticket with the given title, optionally with a link to `githubUrl`. */
  async createTicket(title: string, githubUrl?: string) {
    await this.openCreateForm();
    await this.page.getByPlaceholder('Ticket title').fill(title);
    if (githubUrl) {
      await this.page.getByRole('radio', { name: 'Link', exact: true }).check();
      await this.page.getByLabel('Link to the issue').fill(githubUrl);
      // Wait for title fetch
      await this.page.waitForTimeout(1500);
    }
    await this.page.getByRole('button', { name: 'Create Ticket' }).click();
    // Wait for ticket to appear in the list
    await this.page.waitForTimeout(1000);
  }

  /**
   * Filter the table. Escape closes the suggestion dropdown the input opens, so
   * it cannot sit over the table rows a test goes on to click.
   */
  async search(query: string) {
    await this.searchInput.fill(query);
    await this.searchInput.press('Escape');
    await this.page.waitForTimeout(500);
  }

  /** Clear search, closing the suggestion dropdown as `search` does. */
  async clearSearch() {
    await this.searchInput.clear();
    await this.searchInput.press('Escape');
    await this.page.waitForTimeout(500);
  }

  /** Get the count of visible tickets */
  async getTicketCount(): Promise<number> {
    return await this.activePanel.locator('[data-ticket-id]').count();
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
    return this.page.locator('.tickets-view-panel:visible');
  }

  /** All rows contributed by one source. */
  rowsFromSource(sourceId: 'huddle' | 'redmine'): Locator {
    return this.activePanel.locator(`[data-ticket-source="${sourceId}"]`);
  }

  /** The row for a given ticket title, in whichever tab is showing. */
  rowByTitle(title: string): Locator {
    return this.activePanel.locator('[data-ticket-id]').filter({ hasText: title });
  }

  /** Restrict the list to a single source via the Source filter. */
  async filterBySource(label: 'TimeHuddle' | 'Redmine') {
    await this.filterBy('Source', label);
  }

  /** Sort by a field from the sort-and-filter menu; choosing it again flips the direction. */
  async sortBy(field: string) {
    await this.sortFilterButton.click();
    await this.page
      .getByRole('menu')
      .getByRole('group', { name: 'Sort by' })
      .getByRole('menuitem', { name: new RegExp(`^${field}(\\s*\\(sorted|$)`) })
      .click();
    await this.page.waitForTimeout(300);
  }

  /** How the list is sorted by a field, as the sort-and-filter menu says it in words. */
  async sortStateOf(field: string): Promise<'ascending' | 'descending' | 'none'> {
    await this.sortFilterButton.click();
    const item = this.page
      .getByRole('menu')
      .getByRole('group', { name: 'Sort by' })
      .getByRole('menuitem', { name: new RegExp(`^${field}(\\s*\\(sorted|$)`) });
    const name = (await item.textContent()) ?? '';
    await this.page.keyboard.press('Escape');
    if (name.includes('sorted ascending')) return 'ascending';
    if (name.includes('sorted descending')) return 'descending';
    return 'none';
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
      await this.openSwitch.click();
      await this.page.waitForTimeout(500);
    }
  }
}
