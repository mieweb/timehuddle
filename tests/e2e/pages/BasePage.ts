import type { Page } from '@playwright/test';

/**
 * BasePage - Common functionality for all page objects
 */
export class BasePage {
  constructor(protected page: Page) {}

  /**
   * Navigate to a URL
   */
  async goto(url: string) {
    await this.page.goto(url);
  }

  /**
   * Get the current URL
   */
  async getURL(): Promise<string> {
    return this.page.url();
  }

  /**
   * Wait for a URL pattern
   */
  async waitForURL(urlPattern: string, timeout = 10000) {
    await this.page.waitForURL(urlPattern, { timeout });
  }

  /**
   * Check if user is authenticated (not on login page)
   */
  async isAuthenticated(): Promise<boolean> {
    const url = this.page.url();
    // If we're on /app (login) or showing login form, not authenticated
    if (url.endsWith('/app') && !url.includes('?')) {
      return false;
    }
    // Check if login form is visible
    const loginForm = this.page.getByRole('heading', { name: 'Sign in to your account' });
    try {
      await loginForm.waitFor({ state: 'visible', timeout: 1000 });
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Wait for page to be ready (no loading spinners)
   */
  async waitForReady(timeout = 5000) {
    // Wait for any "Please wait" buttons to disappear
    try {
      await this.page.waitForSelector('button:has-text("Please wait")', {
        state: 'hidden',
        timeout,
      });
    } catch {
      // Ignore if not found
    }
  }
}
