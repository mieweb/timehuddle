import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * TimesheetPage - Page object for the personal timesheet.
 *
 * The standalone /app/timesheet route was retired; the personal timesheet now
 * lives at Dashboard -> Me -> Timesheet. The old URL still redirects there, so
 * goto() keeps using it as a check that the redirect holds.
 */
export class TimesheetPage extends BasePage {
  readonly heading: Locator;
  readonly addEntryButton: Locator;
  readonly totalHours: Locator;
  readonly breakHours: Locator;
  readonly sessionsCount: Locator;
  readonly avgSession: Locator;
  readonly workingDays: Locator;

  constructor(page: Page) {
    super(page);
    // The page heading is the dashboard's now, so the panel is identified by
    // its Add Entry button — unique to the personal timesheet.
    this.heading = this.page.getByRole('heading', { level: 1, name: /Dashboard/i });
    this.addEntryButton = this.page.getByRole('button', { name: 'Add Entry' });
    this.totalHours = this.page.getByText('Total Hours').locator('..');
    this.breakHours = this.page.getByText('Break Hours').locator('..');
    this.sessionsCount = this.page.getByText('Sessions', { exact: true }).locator('..');
    this.avgSession = this.page.getByText('Avg Session').locator('..');
    this.workingDays = this.page.getByText('Working Days').locator('..');
  }

  async goto() {
    await this.page.goto('/app/timesheet');
    await this.waitForLoad();
  }

  async waitForLoad(timeout = 10000) {
    await this.addEntryButton.waitFor({ state: 'visible', timeout });
  }

  /** Open the timesheet from the dashboard's own Me -> Timesheet toggle. */
  async navigateFromDashboard() {
    await this.page.goto('/app/dashboard');
    await this.heading.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator('main').getByRole('button', { name: 'Timesheet', exact: true }).click();
    await this.waitForLoad();
  }

  /** Get preset buttons */
  getPresetButton(name: string): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  /** Click a preset filter */
  async selectPreset(name: string) {
    await this.getPresetButton(name).click();
    await this.page.waitForTimeout(500);
  }

  /** Check if Add Entry button is enabled */
  async isAddEntryEnabled(): Promise<boolean> {
    return !(await this.addEntryButton.isDisabled());
  }

  /** Open Add Entry modal */
  async openAddEntry() {
    await this.addEntryButton.click();
    await this.page.waitForTimeout(500);
  }

  /** Check if summary stats are visible */
  async areSummaryStatsVisible(): Promise<boolean> {
    const totalVisible = await this.page.getByText('Total Hours').isVisible();
    const breakVisible = await this.page.getByText('Break Hours').isVisible();
    const sessionsVisible = await this.page.getByText('Sessions', { exact: true }).isVisible();
    const avgVisible = await this.page.getByText('Avg Session').isVisible();
    const daysVisible = await this.page.getByText('Working Days').isVisible();
    return totalVisible && breakVisible && sessionsVisible && avgVisible && daysVisible;
  }
}
