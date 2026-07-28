import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * TeamSettingsPage - Page object for team settings modal
 */
export class TeamSettingsPage extends BasePage {
  private readonly modal: Locator;
  private readonly requirePlanToggle: Locator;
  private readonly requirePlanSection: Locator;
  private readonly closeButton: Locator;

  constructor(page: Page) {
    super(page);
    this.modal = this.page.getByRole('dialog', { name: 'Team Settings' });
    // The switch has aria-label="Toggle requiring a plan for every clock-in and out"
    this.requirePlanToggle = this.page.getByRole('switch', {
      name: 'Toggle requiring a plan for every clock-in and out',
    });
    this.requirePlanSection = this.page.locator('.team-setting-plan-for-clock');
    this.closeButton = this.modal.getByRole('button', { name: 'Close' }).first();
  }

  /**
   * Wait for the Team Settings modal to appear
   */
  async waitForModal(timeout = 10000) {
    await this.modal.waitFor({ state: 'visible', timeout });
    // Also wait for the plan setting section to be visible
    await this.requirePlanSection.waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if the modal is visible
   */
  async isVisible(): Promise<boolean> {
    return await this.modal.isVisible().catch(() => false);
  }

  /**
   * Enable "Require a plan for every clock-in/out" setting
   */
  async enableRequirePlan() {
    await this.waitForModal();
    // Get the current checked state
    const isChecked = await this.requirePlanToggle.evaluate((el: any) => el.ariaChecked === 'true');
    if (!isChecked) {
      await this.requirePlanToggle.click();
      // Wait for toggle animation and API call
      await this.page.waitForTimeout(800);
    }
  }

  /**
   * Disable "Require a plan for every clock-in/out" setting
   */
  async disableRequirePlan() {
    await this.waitForModal();
    // Get the current checked state
    const isChecked = await this.requirePlanToggle.evaluate((el: any) => el.ariaChecked === 'true');
    if (isChecked) {
      await this.requirePlanToggle.click();
      // Wait for toggle animation and API call
      await this.page.waitForTimeout(800);
    }
  }

  /**
   * Check if "Require a plan for every clock-in/out" is enabled
   */
  async isRequirePlanEnabled(): Promise<boolean> {
    await this.waitForModal();
    return await this.requirePlanToggle.evaluate((el: any) => el.ariaChecked === 'true');
  }

  /**
   * Close the settings modal
   */
  async close() {
    await this.closeButton.click();
    // Wait for modal to close
    await this.modal.waitFor({ state: 'hidden', timeout: 5000 });
  }
}
