import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { TEST_USERS, loginAs } from '../fixtures/users';

/**
 * TeamsPage - Page object for team management
 */
export class TeamsPage extends BasePage {
  private readonly heading: Locator;
  private readonly createTeamButton: Locator;
  private readonly teamsList: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { name: /teams/i });
    this.createTeamButton = this.page.getByRole('button', { name: /create team/i });
    this.teamsList = this.page.getByRole('list').filter({ has: page.getByRole('heading') });
  }

  /**
   * Navigate to teams page.
   *
   * A slow DDP cold-start (backend just warmed up, resume-login retry loop
   * still running) can occasionally bounce this navigation back to the login
   * screen instead of rendering Teams. Mirrors the recovery already used in
   * teams.spec.ts's gotoTeamsPage(): detect the bounce and re-authenticate.
   * Retries a few times — the DDP client's own background reconnect uses
   * capped exponential backoff up to ~46s, so a single retry isn't always
   * enough to land after the resume token is actually usable.
   *
   * The bounce can also happen a beat *after* navigation settles (the app
   * renders optimistically, then redirects once an auth check resolves), so
   * a one-shot `isVisible()` right after `goto` can miss it. Race the two
   * possible headings instead of checking either in isolation.
   */
  async goto() {
    const loginHeading = this.page.getByRole('heading', { name: 'Sign in to your account' });

    for (let attempt = 0; attempt < 3; attempt++) {
      await this.page.goto('/app/teams');

      const landedOnLogin = await Promise.race([
        this.heading.waitFor({ state: 'visible', timeout: 20000 }).then(() => false),
        loginHeading.waitFor({ state: 'visible', timeout: 20000 }).then(() => true),
      ]).catch(() => false);

      if (!landedOnLogin) return;
      await loginAs(this.page, TEST_USERS.owner1);
    }

    await this.waitForLoad();
  }

  /**
   * Navigate via sidebar
   */
  async navigateFromSidebar() {
    await this.page.getByRole('button', { name: /^Teams$/i }).click();
    await this.waitForLoad();
  }

  /**
   * Wait for page to load
   */
  async waitForLoad(timeout = 20000) {
    await this.heading.waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if we're on the teams page
   */
  async isOnTeamsPage(): Promise<boolean> {
    return await this.heading.isVisible();
  }

  /**
   * Get team card by name
   */
  getTeamCard(teamName: string): Locator {
    return this.page.getByRole('article').filter({ hasText: teamName });
  }

  /**
   * Click on a team to view details
   */
  async clickTeam(teamName: string) {
    await this.getTeamCard(teamName).click();
  }

  /**
   * Open team menu
   */
  async openTeamMenu(teamName: string) {
    const teamCard = this.getTeamCard(teamName);
    await teamCard.getByRole('button', { name: /menu|options|more/i }).click();
  }

  /**
   * Invite a user to a team
   */
  async inviteUser(teamName: string, email: string) {
    // Open team details or menu
    await this.clickTeam(teamName);

    // Click invite button
    const inviteButton = this.page.getByRole('button', { name: /invite|add member/i });
    await inviteButton.click();

    // Fill email and submit
    const emailInput = this.page.getByLabel(/email/i);
    await emailInput.fill(email);

    const submitButton = this.page.getByRole('button', { name: /invite|send|add/i }).last();
    await submitButton.click();

    // Wait for success message or modal close
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if user is listed as team member
   */
  async isUserInTeam(teamName: string, userName: string): Promise<boolean> {
    await this.clickTeam(teamName);

    // Look for the user in the members list
    const membersList = this.page
      .getByRole('list')
      .filter({ has: this.page.getByText(/members/i) });
    const member = membersList.getByText(userName);

    return await member.isVisible().catch(() => false);
  }

  /**
   * Get list of all teams visible
   */
  async getTeamNames(): Promise<string[]> {
    const teams = await this.teamsList.getByRole('heading').allTextContents();
    return teams.filter((t) => t.trim().length > 0);
  }

  /**
   * Check if a specific team is visible
   */
  async hasTeam(teamName: string): Promise<boolean> {
    return await this.getTeamCard(teamName)
      .isVisible()
      .catch(() => false);
  }
}
