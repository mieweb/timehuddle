import { expect, type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * ClockPage - Page object for clock in/out
 */
export class ClockPage extends BasePage {
  readonly heading: Locator;
  readonly clockInButton: Locator;
  readonly clockOutButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { level: 1, name: /Clock/i });
    this.clockInButton = this.page.getByRole('button', { name: 'Clock in' });
    this.clockOutButton = this.page.getByRole('button', { name: 'Clock out' });
  }

  async goto() {
    await this.page.goto('/app/clock');
    await this.waitForLoad();
  }

  async waitForLoad(timeout = 10000) {
    await this.heading.waitFor({ state: 'visible', timeout });
  }

  async navigateFromSidebar() {
    await this.page.getByRole('button', { name: /^Clock$/i }).click();
    await this.waitForLoad();
  }

  /** Clock in */
  async clockIn() {
    await this.clockInButton.click();
    // Wait for the button to change to clock out
    await this.clockOutButton.waitFor({ state: 'visible', timeout: 5000 });
  }

  /** Clock out */
  async clockOut() {
    await this.clockOutButton.click();
    // Wait for the button to change to clock in
    await this.clockInButton.waitFor({ state: 'visible', timeout: 5000 });
  }

  /** Check if currently clocked in */
  async isClockedIn(): Promise<boolean> {
    return await this.clockOutButton.isVisible().catch(() => false);
  }
}
