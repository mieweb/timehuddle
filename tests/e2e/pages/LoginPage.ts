import { expect, type Page } from '@playwright/test';
import { BasePage } from './BasePage';
import type { TestUser } from '../fixtures/users';

/**
 * LoginPage - Page object for the login/authentication page
 */
export class LoginPage extends BasePage {
  // Selectors discovered via MCP browser exploration
  private readonly emailInput = this.page.getByRole('textbox', { name: 'Email address' });
  private readonly passwordInput = this.page.getByRole('textbox', { name: 'Password' });
  private readonly signInButton = this.page.getByRole('button', { name: 'Sign in', exact: true });
  private readonly signUpButton = this.page.getByRole('button', { name: 'Sign up', exact: true });
  private readonly forgotPasswordButton = this.page.getByRole('button', {
    name: 'Forgot your password?',
  });
  private readonly heading = this.page.getByRole('heading', { name: 'Sign in to your account' });

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the login page
   */
  async goto() {
    await this.page.goto('/app');
    await this.heading.waitFor({ state: 'visible' });
  }

  /**
   * Check if we're on the login page
   */
  async isOnLoginPage(): Promise<boolean> {
    return await this.heading.isVisible();
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
   * Click sign in button
   */
  async clickSignIn() {
    await this.signInButton.click();
  }

  /**
   * Click sign up button (switches to signup mode)
   */
  async clickSignUp() {
    await this.signUpButton.click();
  }

  /**
   * Click forgot password button
   */
  async clickForgotPassword() {
    await this.forgotPasswordButton.click();
  }

  /**
   * Complete login flow with credentials
   */
  async login(email: string, password: string) {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.clickSignIn();
  }

  /**
   * Login with a test user fixture
   */
  async loginAs(user: TestUser) {
    await this.login(user.email, user.password);
  }

  /**
   * Wait for login to complete (redirect to dashboard or authenticated page)
   */
  async waitForLoginSuccess(timeout = 15000) {
    // Wait for URL change away from /app OR for dashboard content
    await Promise.race([
      this.page.waitForURL('**/dashboard', { timeout }),
      this.page.waitForURL(/\/app\/(?!$)/, { timeout }), // Any /app/* route except /app alone
    ]);
  }

  /**
   * Get error message if login failed
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
   * Check if sign in button is disabled (loading state)
   */
  async isLoading(): Promise<boolean> {
    const pleaseWaitButton = this.page.getByRole('button', { name: 'Please wait…' });
    return await pleaseWaitButton.isVisible();
  }
}
