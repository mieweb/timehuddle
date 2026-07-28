import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * HuddlePage - Page object for huddle feed
 */
export class HuddlePage extends BasePage {
  private readonly heading: Locator;
  private readonly feedTab: Locator;
  private readonly draftsTab: Locator;
  private readonly chatViewButton: Locator;
  private readonly cardViewButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { level: 1, name: 'Huddle' });
    this.feedTab = this.page.getByRole('tab', { name: 'Feed' });
    this.draftsTab = this.page.getByRole('tab', { name: 'Drafts' });
    this.chatViewButton = this.page.getByRole('button', { name: /Switch to chat view/i });
    this.cardViewButton = this.page.getByRole('button', { name: /Switch to card view/i });
  }

  /**
   * Navigate to huddle page
   */
  async goto() {
    await this.page.goto('/app/huddle');
    await this.waitForLoad();
  }

  /**
   * Wait for huddle page to load
   */
  async waitForLoad(timeout = 10000) {
    await this.heading.waitFor({ state: 'visible', timeout });
  }

  /**
   * Navigate via sidebar
   */
  async navigateFromSidebar() {
    await this.page.getByRole('button', { name: /^Huddle$/i }).click();
    await this.waitForLoad();
  }

  /**
   * Check if we're on the huddle page
   */
  async isOnHuddlePage(): Promise<boolean> {
    return await this.heading.isVisible().catch(() => false);
  }

  /**
   * Click on Feed tab
   */
  async clickFeedTab() {
    await this.feedTab.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Click on Drafts tab
   */
  async clickDraftsTab() {
    await this.draftsTab.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Switch to chat view
   */
  async switchToChatView() {
    if (await this.chatViewButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await this.chatViewButton.click();
      // Wait for view to switch
      await this.page.waitForTimeout(1500);
    }
  }

  /**
   * Switch to card view. PostCard (`data-testid="post-card"`) only exists in
   * this view, so post assertions below rely on it.
   */
  async switchToCardView() {
    if (await this.cardViewButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await this.cardViewButton.click();
      // The toggle flips to "chat view" once cards are rendered.
      await this.chatViewButton.waitFor({ timeout: 5000 }).catch(() => {});
    }
    // DDP delivers the feed over WebSockets, so `networkidle` won't cover it.
    await this.page.waitForTimeout(2000);
  }

  /** One card per post — only rendered in card view. */
  private get postCards(): Locator {
    return this.page.locator('[data-testid="post-card"]');
  }

  /**
   * Check if a post with specific text exists in the feed
   */
  async hasPost(text: string): Promise<boolean> {
    await this.switchToCardView();
    try {
      await this.postCards
        .filter({ hasText: text })
        .first()
        .waitFor({ state: 'visible', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all visible posts in the feed, one entry per post
   */
  async getVisiblePosts(): Promise<string[]> {
    await this.switchToCardView();
    await this.postCards
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => {});
    const posts = await this.postCards.allInnerTexts();
    return posts.filter((p) => p.trim().length > 0);
  }

  /**
   * Click on a post to open it (for detailed view or editing)
   */
  async clickPost(text: string) {
    const post = this.page.locator('[data-testid="post-card"]').filter({ hasText: text }).first();
    await post.waitFor({ state: 'visible', timeout: 5000 });
    await post.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Open the edit menu for a post containing specific text
   */
  async openPostMenu(text: string) {
    const post = this.page.locator('[data-testid="post-card"]').filter({ hasText: text }).first();
    const menuButton = post
      .locator('button')
      .filter({ has: this.page.locator('circle') })
      .last();
    await menuButton.click();
  }
}
