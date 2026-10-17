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
  readonly postWrapUpAndClockOutButton: Locator;
  readonly openHuddleLink: Locator;
  // The composer starts collapsed to a single-line stand-in until focused —
  // see `composerExpanded` in ClockPage.tsx. Focusing either swaps in the
  // real rich-text editor (`.ProseMirror`).
  readonly collapsedPlanInput: Locator;
  readonly collapsedWrapUpInput: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { level: 1, name: /Clock/i });
    // Exact — otherwise these substring-match the composer's "Clock in with
    // a plan" / "Clock out with a wrap-up" buttons.
    this.clockInButton = this.page.getByRole('button', { name: 'Clock in', exact: true });
    this.clockOutButton = this.page.getByRole('button', { name: 'Clock out', exact: true });
    this.banner = this.page.locator('.clock-status');
    this.planGateMessage = this.page.getByRole('heading', { name: 'What are you working on?' });
    this.proseMirror = this.page.locator('.ProseMirror').first();
    // Same accessible name whether the composer is collapsed (clicking just
    // expands it) or expanded (clicking submits) — only one is ever mounted.
    this.postPlanAndClockInButton = this.page.getByRole('button', {
      name: /Clock in with a plan/i,
    });
    this.postWrapUpAndClockOutButton = this.page.getByRole('button', {
      name: /Clock out with a wrap-up/i,
    });
    // Rendered as a button that routes client-side, not an anchor — scoped to
    // the composer card, since the sidebar also has a "Huddle" nav button.
    this.openHuddleLink = this.page
      .locator('.clock-plan-composer')
      .getByRole('button', { name: 'Huddle' });
    this.collapsedPlanInput = this.page.getByRole('textbox', { name: 'Write a plan' });
    this.collapsedWrapUpInput = this.page.getByRole('textbox', { name: 'Write a wrap-up' });
  }

  /**
   * Clicking the collapsed single-line stand-in swaps in the real editor.
   * Already-expanded (or the composer genuinely absent) is fine too — waits
   * briefly rather than trusting an instant `isVisible()`, which would read
   * false during the moment right after navigation before React paints.
   */
  private async expandComposer(collapsedInput: Locator) {
    const appeared = await collapsedInput
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (appeared) await collapsedInput.click();
  }

  async goto() {
    await this.page.goto('/app/clock');
    try {
      await this.waitForLoad();
    } catch {
      // One retry absorbs occasional route hydration slowness after auth/setup.
      await this.page.goto('/app/clock');
      await this.waitForLoad();
    }
  }

  async waitForLoad(timeout = 30000) {
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
    await this.expandComposer(this.collapsedPlanInput);
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
   * Type a wrap-up in the editor
   */
  async typeWrapUp(wrapUpText: string) {
    await this.expandComposer(this.collapsedWrapUpInput);
    await this.proseMirror.waitFor({ state: 'visible', timeout: 10000 });
    // The element can be visible a tick before RichEditor finishes hydrating
    // the seeded plan text into it — reading innerText right away occasionally
    // raced an empty document, losing the plan when merged below.
    await this.page.waitForTimeout(300);
    // Rebuild the content deterministically to avoid occasional selection races
    // that can replace the plan text with only the wrap-up.
    const existingText = (await this.proseMirror.innerText()).trim();
    await this.proseMirror.click({ position: { x: 10, y: 10 } });
    await this.page.keyboard.press('ControlOrMeta+a');
    const mergedText = existingText ? `${existingText}\n\n${wrapUpText}` : wrapUpText;
    await this.page.keyboard.type(mergedText, { delay: 10 });
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
    await this.page.waitForURL(/\/huddle(\?|$)/, { timeout: 10000 });
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
   * Check if currently clocked in. Reads the status card rather than the
   * "Clock out" button, which the plan gate replaces with the wrap-up composer
   * — the button's absence does not mean the session ended.
   */
  async isClockedIn(): Promise<boolean> {
    await this.banner.waitFor({ state: 'visible', timeout: 10000 });
    return /Clocked in|On break/i.test(await this.banner.innerText());
  }

  /**
   * Leave the user clocked in, whichever clock-in flow this account is on.
   * Counterpart to `ensureClockedOut` — specs that need a running shift (every
   * ticket-timer spec does, since M3 gates timers on one) call this rather
   * than assuming the previous test's state.
   */
  async ensureClockedIn(plan = 'Plan for a ticket-timer test') {
    await this.goto();
    if (await this.isClockedIn()) return;
    if (await this.clockInButton.isVisible().catch(() => false)) {
      await this.clockIn();
      return;
    }
    // Plan-first flow: the plan composer replaces the bare "Clock in" button.
    await this.typePlan(plan);
    await this.postPlanAndClockIn();
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
