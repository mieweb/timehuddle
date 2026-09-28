import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

type ProfileTab = 'Feed' | 'Media' | 'Work' | 'Activity';

/**
 * ProfilePage - Page object for a person's profile (/app/profile/:userId)
 */
export class ProfilePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Open a profile, optionally deep-linked to a tab (`?tab=media`)
   */
  async gotoUser(userId: string, tab?: ProfileTab) {
    const query = tab ? `?tab=${tab.toLowerCase()}` : '';
    await this.page.goto(`/app/profile/${userId}${query}`);
    await this.tab('Feed').waitFor({ state: 'visible', timeout: 20000 });
  }

  /**
   * A tab in the Feed | Media | Work | Activity rail
   */
  tab(name: ProfileTab): Locator {
    return this.page.getByRole('tab', { name });
  }

  async openTab(name: ProfileTab) {
    await this.tab(name).click();
  }

  /**
   * The post cards on the Feed tab — the person's Huddle posts
   */
  feedPosts(): Locator {
    return this.page
      .getByRole('region', { name: 'Huddle posts by this person' })
      .locator('[data-testid="post-card"]');
  }

  /**
   * A Feed tab post, found by the unique text in its body
   */
  feedPost(uniqueText: string): Locator {
    return this.feedPosts().filter({ hasText: uniqueText });
  }
}
