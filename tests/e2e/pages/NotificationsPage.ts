import { expect, type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * NotificationsPage - Page object for notification management
 */
export class NotificationsPage extends BasePage {
  readonly heading: Locator;
  readonly selectButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { level: 1, name: /Notifications/i });
    this.selectButton = this.page.getByRole('button', { name: 'Select' });
  }

  async goto() {
    await this.page.goto('/app/notifications');
    await this.waitForLoad();
  }

  async waitForLoad(timeout = 10000) {
    await this.heading.waitFor({ state: 'visible', timeout });
  }

  async navigateFromSidebar() {
    await this.page.getByRole('button', { name: /^Notifications$/i }).click();
    await this.waitForLoad();
  }

  /** Check if notifications list is empty */
  async isEmpty(): Promise<boolean> {
    return await this.page.getByText('No notifications yet').isVisible().catch(() => false);
  }

  /** Get notification items */
  getNotificationItems(): Locator {
    return this.page.locator('[role="article"], [data-notification-id], .notification-item');
  }

  /** Get notification count */
  async getNotificationCount(): Promise<number> {
    if (await this.isEmpty()) return 0;
    return await this.getNotificationItems().count();
  }

  /** Click Select mode to enable multi-select */
  async enterSelectMode() {
    await this.selectButton.click();
    await this.page.waitForTimeout(300);
  }

  /** Select all notifications */
  async selectAll() {
    const selectAllBtn = this.page.getByRole('button', { name: /select all/i });
    if (await selectAllBtn.isVisible()) {
      await selectAllBtn.click();
      await this.page.waitForTimeout(300);
    }
  }

  /** Mark selected as read */
  async markAsRead() {
    const markBtn = this.page.getByRole('button', { name: /mark.*read/i });
    if (await markBtn.isVisible()) {
      await markBtn.click();
      await this.page.waitForTimeout(500);
    }
  }

  /** Delete selected notifications */
  async deleteSelected() {
    const deleteBtn = this.page.getByRole('button', { name: /delete/i });
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await this.page.waitForTimeout(500);
    }
  }
}
