import { expect, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * SignupPage - Page object for the signup/registration page
 */
export class SignupPage extends BasePage {
  private readonly emailInput = this.page.getByRole('textbox', { name: 'Email address' });
  private readonly passwordInput = this.page.getByRole('textbox', { name: 'Password' });
  private readonly confirmPasswordInput = this.page.getByRole('textbox', {
    name: 'Confirm password',
  });
  private readonly nameInput = this.page.getByRole('textbox', { name: 'Full name' });
  private readonly signUpButton = this.page.getByRole('button', { name: 'Sign up', exact: true });
  private readonly signInButton = this.page.getByRole('button', { name: 'Sign in', exact: true });
  private readonly heading = this.page.getByRole('heading', { name: /Create.*account/i });

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the signup page
   */
  async goto() {
    await this.page.goto('/app?mode=signup');
    // Wait for either heading to appear
    await Promise.race([
      this.heading.waitFor({ state: 'visible' }),
      this.page.waitForTimeout(3000),
    ]);
  }

  /**
   * Check if we're on the signup page
   */
  async isOnSignupPage(): Promise<boolean> {
    try {
      return await this.heading.isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  /**
   * Fill in name field
   */
  async fillName(name: string) {
    await this.nameInput.fill(name);
  }

  /**
   * Fill in email field
   */
  async fillEmail(email: string) {
    await this.emailInput.fill(email);
  }

  /**
   * Fill in password field
   */
  async fillPassword(password: string) {
    await this.passwordInput.fill(password);
  }

  /**
   * Fill in confirm password field
   */
  async fillConfirmPassword(password: string) {
    await this.confirmPasswordInput.fill(password);
  }

  /**
   * Click sign up button
   */
  async clickSignUp() {
    await this.signUpButton.click();
  }

  /**
   * Click sign in button (switches to login mode)
   */
  async clickSignIn() {
    await this.signInButton.click();
  }

  /**
   * Complete signup flow
   */
  async signup(name: string, email: string, password: string) {
    await this.fillName(name);
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.fillConfirmPassword(password);
    await this.clickSignUp();
  }

  /**
   * Wait for signup to complete (redirect to dashboard)
   */
  async waitForSignupSuccess(timeout = 15000) {
    await Promise.race([
      this.page.waitForURL('**/dashboard', { timeout }),
      this.page.waitForURL(/\/app\/(?!$)/, { timeout }),
    ]);
  }

  /**
   * Get error message if signup failed
   */
  async getErrorMessage(): Promise<string | null> {
    const alert = this.page.getByRole('alert');
    try {
      await alert.waitFor({ state: 'visible', timeout: 2000 });
      return await alert.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Check if sign up button is disabled (loading state)
   */
  async isLoading(): Promise<boolean> {
    const pleaseWaitButton = this.page.getByRole('button', { name: 'Please wait…' });
    return await pleaseWaitButton.isVisible();
  }
}
