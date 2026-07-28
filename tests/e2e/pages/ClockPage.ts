import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * ClockPage - Page object for clock in/out
 */
export class ClockPage extends BasePage {
  readonly heading: Locator;
  readonly clockInButton: Locator;
  readonly clockOutButton: Locator;
  readonly banner: Locator;
  readonly planGateMessage: Locator;
  readonly proseMirror: Locator;
  readonly postPlanAndClockInButton: Locator;
  readonly saveDraftButton: Locator;
  readonly updateDraftButton: Locator;
  readonly postWrapUpAndClockOutButton: Locator;
  readonly openHuddleLink: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { level: 1, name: /Clock/i });
    // Exact — otherwise these substring-match the composer's "Post plan and
    // clock in" / "Post wrap-up and clock out" buttons.
    this.clockInButton = this.page.getByRole('button', { name: 'Clock in', exact: true });
    this.clockOutButton = this.page.getByRole('button', { name: 'Clock out', exact: true });
    this.banner = this.page.locator('.clock-banner');
    this.planGateMessage = this.page.getByText(/Write a plan before starting this session/);
    this.proseMirror = this.page.locator('.ProseMirror').first();
    this.postPlanAndClockInButton = this.page.getByRole('button', {
      name: /Post plan and clock in/i,
    });
    this.saveDraftButton = this.page.getByRole('button', { name: /Save draft/i });
    this.updateDraftButton = this.page.getByRole('button', { name: /Update draft/i });
    this.postWrapUpAndClockOutButton = this.page.getByRole('button', {
      name: /Post wrap-up and clock out/i,
    });
    // Rendered as a button that routes client-side, not an anchor.
    this.openHuddleLink = this.page.getByRole('button', { name: /Open huddle/i });
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

  /**
   * Check if plan gate message is displayed
   */
  async isPlanGateVisible(): Promise<boolean> {
    return await this.planGateMessage.isVisible().catch(() => false);
  }

  /**
   * Type a plan in the editor
   */
  async typePlan(planText: string) {
    await this.proseMirror.waitFor({ state: 'visible', timeout: 10000 });
    await this.proseMirror.click({ position: { x: 10, y: 10 } });
    // Select any existing content so typing replaces it (ControlOrMeta keeps
    // this working on both macOS and Linux/CI).
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.type(planText, { delay: 10 });
  }

  /**
   * Post plan and clock in
   */
  async postPlanAndClockIn() {
    await this.postPlanAndClockInButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.postPlanAndClockInButton.click();
    // Wait for the page to update after clock in
    await this.page.waitForTimeout(1500);
  }

  /**
   * Save as draft
   */
  async saveDraft() {
    await this.saveDraftButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.saveDraftButton.click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Update an existing draft
   */
  async updateDraft() {
    await this.updateDraftButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.updateDraftButton.click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Type a wrap-up in the editor
   */
  async typeWrapUp(wrapUpText: string) {
    await this.proseMirror.waitFor({ state: 'visible', timeout: 10000 });
    // The composer is seeded with this session's plan post — append after it.
    // "End" only reaches end-of-line (and is a no-op in ProseMirror on macOS),
    // so select the whole document and collapse the selection to its end.
    await this.proseMirror.click({ position: { x: 10, y: 10 } });
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.press('ArrowRight');
    await this.page.keyboard.type('\n\n' + wrapUpText, { delay: 10 });
  }

  /**
   * Post wrap-up and clock out
   */
  async postWrapUpAndClockOut() {
    await this.postWrapUpAndClockOutButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.postWrapUpAndClockOutButton.click();
    // Wait for the page to update after clock out
    await this.page.waitForTimeout(1500);
  }

  /**
   * Click "Open huddle" link to navigate to huddle page
   */
  async openHuddleFromClockPage() {
    await this.openHuddleLink.waitFor({ state: 'visible', timeout: 10000 });
    await this.openHuddleLink.click();
    await this.page.waitForURL('**/huddle', { timeout: 10000 });
  }

  /** Clock in (legacy method for non-plan-first flow) */
  async clockIn() {
    await this.clockInButton.click();
    // Wait for the button to change to clock out
    await this.clockOutButton.waitFor({ state: 'visible', timeout: 5000 });
  }

  /** Clock out (legacy method for non-plan-first flow) */
  async clockOut() {
    await this.clockOutButton.click();
    // Wait for the button to change to clock in
    await this.clockInButton.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Check if currently clocked in. Reads the status banner rather than the
   * "Clock out" button, which the plan gate replaces with the wrap-up composer
   * — the button's absence does not mean the session ended.
   */
  async isClockedIn(): Promise<boolean> {
    await this.banner.waitFor({ state: 'visible', timeout: 10000 });
    return /On shift|On break/i.test(await this.banner.innerText());
  }

  /**
   * Leave the user clocked out. Specs in this serial suite share seed users and
   * a database, so an earlier test can leave a session open — which renders the
   * clock page in wrap-up mode and hides the plan composer entirely.
   */
  async ensureClockedOut() {
    await this.goto();
    if (await this.clockOutButton.isVisible().catch(() => false)) {
      await this.clockOut();
      return;
    }
    // Plan-gated session: clocking out requires posting a wrap-up. Always type
    // one — the seeded plan may not have loaded yet, and the button stays
    // disabled while the composer is empty.
    if (await this.postWrapUpAndClockOutButton.isVisible().catch(() => false)) {
      await this.typeWrapUp('Cleanup wrap-up from a previous test');
      await this.postWrapUpAndClockOut();
    }
  }
}
