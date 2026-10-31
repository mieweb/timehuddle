/**
 * Huddle's own message box with files: what a post's photos and documents look
 * like in the thread, the viewer that opens them, and the files the box turns
 * away. Everything goes through the real upload endpoint and `huddle.createPost`.
 *
 * The other composer specs drive the Clock tab's plan composer; these drive the
 * Huddle page's message box (SuperChat's ChatComposer), whose hidden file input
 * is the one that accepts listed image formats (not `image/*`).
 */
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  FIXTURE,
  editInboxMessage,
  inboxComposer,
  openPostInInbox,
  sendFromInbox,
} from './helpers';

/** The message box's own file input (Pulse's video input is another one). */
const fileInput = (page: Page) => page.locator('input[type="file"][accept*="image/jpeg"]');

const image = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: fs.readFileSync(FIXTURE.image),
});

test.describe('Huddle message box — photos and documents', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await page.goto('/app/huddle');
  });

  test('posts photos as one gallery and a document as a list, under the text', async ({ page }) => {
    const text = `Gallery and a doc ${Date.now()}`;
    await fileInput(page).setInputFiles([
      image('whiteboard.png'),
      image('dashboard.png'),
      { name: 'agenda.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
    ]);
    await inboxComposer(page).fill(text);
    await sendFromInbox(page);

    const post = await openPostInInbox(page, text);
    const gallery = post.locator('[data-slot="superchat-message-gallery"]');
    await expect(gallery.getByRole('button')).toHaveCount(2);
    await expect(post.locator('[data-slot="superchat-message-files"]')).toContainText('agenda.pdf');
    // Under the text, not inside its bubble.
    await expect(
      post.locator('[data-slot="superchat-bubble"] [data-slot="superchat-message-gallery"]'),
    ).toHaveCount(0);

    // A cell opens the viewer over the window, where it is in its message.
    await gallery.getByRole('button').first().click();
    const viewer = page.getByRole('dialog', { name: 'Media' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole('group', { name: 'In this message' })).toContainText('1 of 2');
    await expect(viewer.getByRole('textbox')).toHaveCount(0);
    await viewer.getByRole('button', { name: '2 of 2' }).click();
    await expect(viewer.getByRole('group', { name: 'In this message' })).toContainText('2 of 2');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();

    // An edit can take one off; the other is then a lone tile.
    await editInboxMessage(page, post);
    await page.getByRole('button', { name: 'Remove whiteboard.png' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(post.locator('[data-slot="superchat-message-gallery"]')).toHaveCount(0);
    await expect(post.locator('[data-slot="superchat-message-media"]')).toHaveCount(1);
  });

  test('says why it turns a file away, and keeps the rest', async ({ page }) => {
    await fileInput(page).setInputFiles([
      { name: 'IMG_0042.HEIC', mimeType: 'image/heic', buffer: Buffer.from('heic') },
      image('kept.png'),
    ]);
    await expect(page.getByText(/IMG_0042\.HEIC is a HEIC photo/)).toBeVisible();
    await expect(page.getByLabel('Remove kept.png')).toBeVisible();

    await fileInput(page).setInputFiles({
      name: 'long-demo.mov',
      mimeType: 'video/quicktime',
      buffer: Buffer.alloc(26 * 1024 * 1024),
    });
    await expect(
      page.getByText(/long-demo\.mov is over 25 MB\. Post a longer video with Pulse/),
    ).toBeVisible();
  });
});
