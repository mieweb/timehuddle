import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { keepShortStintUpdates } from '../fixtures/timers';

/** Properties with nothing to filter: their pill is the sort itself. */
const SORT_ONLY_FIELDS = new Set(['Title', 'Updated']);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * TicketsPage - Page object for the unified ticket list.
 *
 * The page has two views over the same list, chosen with a switcher: My Board, which it opens on, and
 * All Sources, which shows every source (TimeHuddle, Redmine) at once. Rows
 * carry `data-ticket-source` so tests can assert on provenance. Sorting and
 * filtering are pills in the list header, beside the Open/Closed switcher: a
 * property only sorted by is a button, one that can be filtered opens a menu.
 * The pills that do not fit the header's line are reached through a chevron
 * that opens a pane of them all (`showAllControls`); the rows scroll under
 * that header.
 *
 * `goto()` lands on All Sources, because that is the table most specs are
 * about; a spec about the board switches with `switchToTab('my-board')`, and
 * one about the page's own default uses `page.goto('/app/tickets')`.
 */
export class TicketsPage extends BasePage {
  readonly heading: Locator;
  readonly newTicketButton: Locator;
  readonly searchInput: Locator;
  /** The search bar's dropdown, where its results show; it does not filter the table. */
  readonly searchMenu: Locator;
  /** The chevron that opens the pane of every sort and filter pill, when they do not all fit. */
  readonly showAllControlsButton: Locator;
  readonly openOption: Locator;
  readonly closedOption: Locator;
  readonly clearFiltersButton: Locator;
  readonly selectAllCheckbox: Locator;
  /** Turns the rows' checkboxes on ("Select") and off ("Done"). */
  readonly selectModeButton: Locator;
  readonly doneSelectingButton: Locator;
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
    // A combobox: its results are tickets and Redmine issues in a dropdown
    // (#736c), and it no longer filters the table.
    this.searchInput = this.page.getByRole('combobox', {
      name: 'Search tickets and Redmine issues',
    });
    this.searchMenu = this.page.getByRole('listbox', { name: 'Redmine suggestions' });
    // Open/Closed sits in the list header at every width, labelled with its counts.
    this.showAllControlsButton = this.page.getByRole('button', {
      name: /^Show all sort and filter controls/,
    });
    this.openOption = this.page.getByRole('radio', { name: /^Open tickets/ });
    this.closedOption = this.page.getByRole('radio', { name: /^Closed tickets/ });
    this.clearFiltersButton = this.page.getByRole('button', { name: 'Clear filters' });
    this.selectAllCheckbox = this.page.getByRole('checkbox', { name: /Select all tickets/i });
    this.selectModeButton = this.page.getByRole('button', { name: 'Select', exact: true });
    this.doneSelectingButton = this.page.getByRole('button', { name: 'Done', exact: true });
    this.ticketsTab = this.page.getByRole('radio', { name: 'All Sources' });
    this.myBoardTab = this.page.getByRole('radio', { name: 'My Board' });
    this.moveToBoardButton = this.page.getByRole('button', { name: 'Move to My Board' });
    this.removeFromBoardButton = this.page.getByRole('button', { name: 'Remove from My Board' });
    this.deselectAllButton = this.page.getByRole('button', { name: 'Deselect all' });
    this.bulkDeleteButton = this.page.getByRole('button', { name: 'Delete selected tickets' });
    this.archiveButton = this.page.getByRole('button', { name: 'Archive' });
    this.closeIssuesButton = this.page.getByRole('button', { name: 'Close Issues' });
    // Specs here stop and switch timers within seconds; see the fixture.
    void keepShortStintUpdates(page);
  }

  /** Switch between the All Sources (`tickets`) and My Board tabs (same URL). */
  async switchToTab(tab: 'tickets' | 'my-board') {
    await (tab === 'tickets' ? this.ticketsTab : this.myBoardTab).click();
    await this.page.waitForTimeout(300);
  }

  /** Check a ticket row's selection checkbox by title. */
  async selectTicket(title: string) {
    if (await this.selectModeButton.isVisible()) await this.selectModeButton.click();
    await this.rowByTitle(title).getByRole('checkbox').click();
  }

  /**
   * The ▶/⏸ button on a row, on either view. Off My Board its name says the
   * start adds the ticket first (see `addAndStartButton`).
   */
  timerButtonForRow(title: string): Locator {
    return this.rowByTitle(title).getByRole('button', { name: /start timer|stop timer/i });
  }

  /** A row's My Board toggle, while the ticket is off the board. */
  addToBoardRowButton(title: string): Locator {
    return this.rowByTitle(title).getByRole('button', {
      name: `Add ${title} to My Board`,
      exact: true,
    });
  }

  /** A row's My Board toggle, while the ticket is on the board. */
  removeFromBoardRowButton(title: string): Locator {
    return this.rowByTitle(title).getByRole('button', { name: `Remove ${title} from My Board` });
  }

  /** The start button of a row that is off My Board: it adds the ticket, then starts. */
  addAndStartButton(title: string): Locator {
    return this.rowByTitle(title).getByRole('button', {
      name: `Add ${title} to My Board and start timer`,
    });
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

  /** Open the pane of every sort and filter pill, where the header's line cannot hold them. */
  async showAllControls() {
    if (await this.showAllControlsButton.isVisible()) await this.showAllControlsButton.click();
  }

  /** The pill of a property that can be filtered; it opens that property's menu. */
  filterControl(field: string): Locator {
    // A pill with only view options, such as Issue #, opens "Options for …".
    return this.page.getByRole('button', {
      name: new RegExp(`^(Filter by|Options for) ${escapeRegExp(field)}(?::|$)`),
    });
  }

  /** The pill of a property that is only sorted by; pressing it sorts, then reverses. */
  sortControl(field: string): Locator {
    return this.page.getByRole('button', {
      name: new RegExp(`^(Sort by ${escapeRegExp(field)}$|Sorted by ${escapeRegExp(field)},)`),
    });
  }

  /** Open a property's filter menu, from the header's line or from its pane. */
  async openFilter(field: string) {
    await this.showAllControls();
    await this.filterControl(field).click();
  }

  /**
   * Pick a value in a property's filter menu. A property that takes several
   * values leaves its menu open, so it is closed here.
   */
  async filterBy(field: string, option: string) {
    await this.openFilter(field);
    const menu = this.page.getByRole('menu');
    await menu
      .locator('[role="menuitem"], [role="menuitemcheckbox"]')
      .filter({ hasText: new RegExp(`^${escapeRegExp(option)}(\\(selected\\))?$`) })
      .click();
    await this.page.waitForTimeout(150);
    if (await menu.isVisible()) await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
  }

  /** Turn every filter off. */
  async clearFilters() {
    await this.showAllControls();
    await this.clearFiltersButton.click();
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

  /** The "Sort by …" item at the top of a filterable property's menu. Opens the menu. */
  private async openSortItem(field: string): Promise<Locator> {
    await this.openFilter(field);
    return this.page
      .getByRole('menu')
      .getByRole('menuitem', { name: new RegExp(`^Sort by ${escapeRegExp(field)}`) });
  }

  /** Sort by a property; choosing it again flips the direction. */
  async sortBy(field: string) {
    if (SORT_ONLY_FIELDS.has(field)) {
      await this.showAllControls();
      await this.sortControl(field).click();
    } else {
      await (await this.openSortItem(field)).click();
    }
    await this.page.waitForTimeout(300);
  }

  /** How the list is sorted by a property, as its control says it in words. */
  async sortStateOf(field: string): Promise<'ascending' | 'descending' | 'none'> {
    let name: string;
    if (SORT_ONLY_FIELDS.has(field)) {
      await this.showAllControls();
      name = (await this.sortControl(field).getAttribute('aria-label')) ?? '';
    } else {
      name = (await (await this.openSortItem(field)).textContent()) ?? '';
      await this.page.keyboard.press('Escape');
    }
    if (name.includes('ascending')) return 'ascending';
    if (name.includes('descending')) return 'descending';
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
    await this.closedOption.click();
    await this.page.waitForTimeout(500);
  }

  /** Switch back to open tickets */
  async showOpenTickets() {
    await this.openOption.click();
    await this.page.waitForTimeout(500);
  }
}
