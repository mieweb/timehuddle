import { expect, type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * TimesheetPage - Page object for the personal timesheet
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
    this.heading = this.page.getByRole('heading', { level: 1, name: /Timesheet/i });
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
    await this.heading.waitFor({ state: 'visible', timeout });
  }

  async navigateFromSidebar() {
    await this.page.getByRole('button', { name: /^Timesheet$/i }).click();
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
