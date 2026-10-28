import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * TeamSettingsPage - Page object for a team's Settings tab on the Teams page
 */
export class TeamSettingsPage extends BasePage {
  private readonly panel: Locator;
  private readonly requirePlanToggle: Locator;
  private readonly requirePlanSection: Locator;
  private readonly membersTab: Locator;

  constructor(page: Page) {
    super(page);
    this.panel = this.page.locator('.team-settings-panel');
    // The switch has aria-label="Toggle requiring a plan for every clock-in and out"
    this.requirePlanToggle = this.page.getByRole('switch', {
      name: 'Toggle requiring a plan for every clock-in and out',
    });
    this.requirePlanSection = this.page.locator('.team-setting-plan-for-clock');
    this.membersTab = this.page.getByRole('tab', { name: 'Members', exact: true });
  }

  /**
   * Wait for the Settings tab's panel to appear
   */
  async waitForModal(timeout = 10000) {
    await this.panel.waitFor({ state: 'visible', timeout });
    // Also wait for the plan setting section to be visible
    await this.requirePlanSection.waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if the Settings tab's panel is visible
   */
  async isVisible(): Promise<boolean> {
    return await this.panel.isVisible().catch(() => false);
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
   * Leave the Settings tab, back to Members
   */
  async close() {
    await this.membersTab.click();
    await this.panel.waitFor({ state: 'hidden', timeout: 5000 });
  }
}
