import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * OrganizationPage - Page object for organization management
 */
export class OrganizationPage extends BasePage {
  private readonly heading: Locator;
  private readonly membersTab: Locator;
  private readonly membersList: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { name: /organization/i });
    this.membersTab = this.page.getByRole('tab', { name: /members/i });
    this.membersList = this.page.getByRole('list').filter({ has: page.getByText(/member/i) });
  }

  /**
   * Navigate to organization page
   */
  async goto() {
    await this.page.goto('/app/organization');
    await this.waitForLoad();
  }

  /**
   * Navigate via sidebar
   */
  async navigateFromSidebar() {
    await this.page.getByRole('button', { name: /^Organization$/i }).click();
    await this.waitForLoad();
  }

  /**
   * Wait for page to load
   */
  async waitForLoad(timeout = 10000) {
    await this.heading.waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if we're on the organization page
   */
  async isOnOrganizationPage(): Promise<boolean> {
    return await this.heading.isVisible();
  }

  /**
   * Navigate to members tab
   */
  async goToMembers() {
    await this.membersTab.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if user is listed as organization member
   */
  async isUserInOrganization(userName: string): Promise<boolean> {
    // Make sure we're on members tab
    await this.goToMembers();
    
    // Look for the user in the members list
    const member = this.page.getByText(userName);
    return await member.isVisible().catch(() => false);
  }

  /**
   * Get organization name
   */
  async getOrganizationName(): Promise<string> {
    const orgName = this.page.getByRole('heading', { level: 1 });
    return (await orgName.textContent()) || '';
  }

  /**
   * Check if organization section is visible in sidebar
   */
  async hasOrganizationInSidebar(): Promise<boolean> {
    const orgButton = this.page.getByRole('button', { name: /^Organization$/i });
    return await orgButton.isVisible().catch(() => false);
  }

  /**
   * Get user role in organization
   */
  async getUserRole(userName: string): Promise<string | null> {
    await this.goToMembers();
    
    // Find the row containing the user
    const userRow = this.page.getByRole('row').filter({ hasText: userName });
    
    // Get the role cell
    const roleCell = userRow.getByRole('cell').filter({ hasText: /owner|admin|member/i });
    return (await roleCell.textContent()) || null;
  }
}
