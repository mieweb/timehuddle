/**
 * Huddle's own message box with files: what a post's photos and documents look
 * like in the thread, the media view that opens them, and the files the box
 * turns away. Everything goes through the real upload endpoint and `huddle.createPost`.
 *
 * The other composer specs drive the Clock tab's plan composer; these drive the
 * Huddle page's message box (SuperChat's ChatComposer), whose hidden file input
 * is the one that accepts listed image formats (not `image/*`). Files are only
 * staged in the size tests, never sent.
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

    // A cell opens the conversation's media view in place of the thread, on
    // that photo, with the message box still under it.
    await gallery.getByRole('button').first().click();
    const mediaView = page.locator('[data-slot="superchat-media-view"]');
    await expect(mediaView).toBeVisible();
    await expect(mediaView.locator('[data-active="true"] img[alt="whiteboard.png"]')).toBeVisible();
    await expect(inboxComposer(page)).toBeVisible();
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    await expect(mediaView).toBeHidden();

    // An edit can take one off; the other is then a lone tile.
    await editInboxMessage(page, post);
    await page.getByRole('button', { name: 'Remove attachment whiteboard.png' }).click();
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
    await expect(page.getByLabel(/^(Cancel upload of|Remove attachment) kept\.png$/)).toBeVisible();

    // Each file has its own cap: 500 MB for a video, 100 MB for anything else.
    // Over Playwright's 50 MB in-memory limit, so these are (sparse) files.
    const overCap = (name: string, megabytes: number) => {
      const path = test.info().outputPath(name);
      fs.writeFileSync(path, '');
      fs.truncateSync(path, megabytes * 1024 * 1024 + 1);
      return path;
    };
    await fileInput(page).setInputFiles(overCap('scan.pdf', 100));
    await expect(page.getByText('scan.pdf is over 100 MB.')).toBeVisible();
    await fileInput(page).setInputFiles(overCap('too-long.mp4', 500));
    await expect(page.getByText('too-long.mp4 is over 500 MB.')).toBeVisible();
  });

  test('takes a video over the old 25 MB cap', async ({ page }) => {
    await fileInput(page).setInputFiles({
      name: 'long-demo.mov',
      mimeType: 'video/quicktime',
      buffer: Buffer.alloc(26 * 1024 * 1024),
    });
    // Uploading as soon as it's added ("Cancel upload of …"), then "Remove attachment …".
    await expect(
      page.getByLabel(/^(Cancel upload of|Remove attachment) long-demo\.mov$/),
    ).toBeVisible();
    await expect(page.getByText(/long-demo\.mov is over/)).toHaveCount(0);
  });
});
