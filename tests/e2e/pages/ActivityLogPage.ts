import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * ActivityLogPage - Page object for activity log
 */
export class ActivityLogPage extends BasePage {
  readonly heading: Locator;
  readonly description: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { level: 2, name: 'Activity log' });
    this.description = this.page.getByText('Your clock-ins, tickets and other actions');
  }

  async goto() {
    await this.page.goto('/app/settings?section=activity');
    await this.waitForLoad();
  }

  async waitForLoad(timeout = 10000) {
    await this.heading.waitFor({ state: 'visible', timeout });
  }

  /** Check if activity log is empty */
  async isEmpty(): Promise<boolean> {
    return await this.page
      .getByText('No activity yet')
      .isVisible()
      .catch(() => false);
  }

  /** Get activity log items */
  getActivityItems(): Locator {
    return this.page.locator(
      '[role="article"], [data-activity-id], .activity-item, [class*="activity"]',
    );
  }

  /** Get activity count */
  async getActivityCount(): Promise<number> {
    if (await this.isEmpty()) return 0;
    return await this.getActivityItems().count();
  }

  /** Check if a specific activity message is visible */
  async hasActivity(text: string): Promise<boolean> {
    return await this.page
      .getByText(text, { exact: false })
      .isVisible()
      .catch(() => false);
  }
}
