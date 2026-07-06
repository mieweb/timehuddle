import { type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * SignupPage - Page object for the signup/registration page
 */
export class SignupPage extends BasePage {
  private readonly firstNameInput = this.page.getByRole('textbox', { name: 'First name' });
  private readonly lastNameInput = this.page.getByRole('textbox', { name: 'Last name' });
  private readonly emailInput = this.page.getByRole('textbox', { name: 'Email address' });
  private readonly passwordInput = this.page.getByRole('textbox', {
    name: 'Password',
    exact: true,
  });
  private readonly confirmPasswordInput = this.page.getByRole('textbox', {
    name: 'Confirm password',
  });
  private readonly createAccountButton = this.page.getByRole('button', {
    name: 'Create account',
    exact: true,
  });
  private readonly signInButton = this.page.getByRole('button', { name: 'Sign in', exact: true });
  private readonly heading = this.page.getByRole('heading', { name: /Create.*account/i });

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the signup page
   */
  async goto() {
    await this.page.goto('http://localhost:3000/app?mode=signup');
    await this.heading.waitFor({ state: 'visible', timeout: 10000 });
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
   * Fill in first name field
   */
  async fillFirstName(firstName: string) {
    await this.firstNameInput.fill(firstName);
  }

  /**
   * Fill in last name field
   */
  async fillLastName(lastName: string) {
    await this.lastNameInput.fill(lastName);
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
   * Click create account button
   */
  async clickCreateAccount() {
    await this.createAccountButton.click();
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
  async signup(firstName: string, lastName: string, email: string, password: string) {
    await this.fillFirstName(firstName);
    await this.fillLastName(lastName);
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.fillConfirmPassword(password);
    await this.clickCreateAccount();
  }

  /**
   * Handle the Username Required dialog that appears after signup.
   * Claims the suggested username or a custom one.
   */
  async claimUsername(username?: string) {
    const dialog = this.page.getByRole('dialog', { name: 'Username Required' });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });

    if (username) {
      const usernameInput = dialog.getByRole('textbox', { name: 'Username' });
      await usernameInput.clear();
      await usernameInput.fill(username);
      // Wait for availability check
      await this.page.waitForTimeout(1000);
    }

    await dialog.getByRole('button', { name: 'Claim username' }).click();
    // Wait for dialog to close
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
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
      await alert.waitFor({ state: 'visible', timeout: 3000 });
      return await alert.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Check if create account button is disabled (loading state)
   */
  async isLoading(): Promise<boolean> {
    const pleaseWaitButton = this.page.getByRole('button', { name: 'Please wait…' });
    return await pleaseWaitButton.isVisible();
  }
}
