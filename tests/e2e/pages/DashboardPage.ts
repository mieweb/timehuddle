import { type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * DashboardPage - Page object for the authenticated dashboard
 */
export class DashboardPage extends BasePage {
  private readonly sidebar = this.page.getByRole('navigation', { name: 'Main navigation' });
  private readonly heading = this.page.getByRole('heading', { level: 1 });
  private readonly accountMenuButton = this.page.getByRole('button', { name: 'Account menu' });

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the dashboard
   */
  async goto() {
    await this.page.goto('/dashboard');
    await this.waitForLoad();
  }

  /**
   * Wait for dashboard to load
   */
  async waitForLoad(timeout = 10000) {
    await this.sidebar.waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if we're on the dashboard
   */
  async isOnDashboard(): Promise<boolean> {
    return await this.hasSidebar();
  }

  /**
   * Check if sidebar is visible (indicates authenticated state). Waits for it
   * rather than checking once: the app shell is lazy-loaded, so right after
   * login the page briefly shows a loading spinner before the sidebar mounts.
   */
  async hasSidebar(timeout = 10000): Promise<boolean> {
    return this.waitForLoad(timeout).then(
      () => true,
      () => false,
    );
  }

  /**
   * Get the main heading text
   */
  async getHeadingText(): Promise<string> {
    return (await this.heading.textContent()) || '';
  }

  /**
   * Open the account menu
   */
  async openAccountMenu() {
    await this.accountMenuButton.click();
  }

  /**
   * Navigate to profile page via account menu
   */
  async goToProfile() {
    await this.openAccountMenu();
    await this.page.getByRole('menuitem', { name: /Profile/i }).click();
  }

  /**
   * Logout via account menu
   */
  async logout() {
    await this.openAccountMenu();
    await this.page.waitForTimeout(500); // Wait for menu to open
    await this.page.getByRole('menuitem', { name: /Sign out/i }).click();
  }
}
