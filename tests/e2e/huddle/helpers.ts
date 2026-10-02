/**
 * Shared helpers for the Huddle composer/feed specs.
 *
 * The feed is a SuperChatInbox, and the Huddle page only shows its own rich
 * composer for a team's very first post. The full composer (MarkdownEditor +
 * the Photo/Video/Doc/Pulse/Ticket/@Mention bar) lives on the Clock tab as the
 * plan-before-clock-in composer, so the composer specs drive that one: turn the
 * shared team's plan gate on, write the plan, post it (which clocks in), then
 * find the post in the inbox by its unique body text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { ClockPage } from '../pages/ClockPage';

const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

/** Real fixture files, uploaded through the actual backend endpoints. */
export const FIXTURE = {
  image: path.join(FIXTURES_DIR, 'test-image.png'),
  doc: path.join(FIXTURES_DIR, 'test-doc.txt'),
  video: path.join(FIXTURES_DIR, 'test-video.mp4'),
};

/**
 * The composer's editable surface. Kerebron's RichEditor renders a ProseMirror
 * contenteditable rather than a <textarea>, so there is no placeholder
 * attribute to select on — the visible prompt is a CSS `::before`.
 */
export function composerEditor(page: Page) {
  return page.locator('.markdown-editor .ProseMirror').first();
}

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    return await fn(client.db());
  } finally {
    await client.close();
  }
}

/**
 * Turn the shared team's (TEST01) "require a plan" setting on or off. On, the
 * Clock tab replaces its plain Clock in button with the plan composer. Call it
 * from `beforeAll`/`afterAll` so the rest of the serial suite sees the default.
 */
export async function setSharedTeamPlanGate(enabled: boolean): Promise<void> {
  await withDb((db) =>
    db
      .collection('teams')
      .updateOne({ code: 'TEST01' }, { $set: { 'settings.requirePlanForClock': enabled } }),
  );
}

/** The seed user's `_id`. */
export async function getUserIdByEmail(email: string): Promise<string> {
  const user = await withDb((db) =>
    db.collection('users').findOne({ 'emails.address': email }, { projection: { _id: 1 } }),
  );
  if (!user) throw new Error(`Seed user ${email} not found — did global-setup run?`);
  return String(user._id);
}

/** The stored huddle post whose body contains `text`. */
export async function findPostByText(
  text: string,
): Promise<{ content: { text: string; mentions: string[] } } | null> {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return withDb((db) =>
    db
      .collection<{ content: { text: string; mentions: string[] } }>('huddlePosts')
      .findOne({ 'content.text': { $regex: escaped } }),
  );
}

/**
 * Open the Clock tab's plan composer. Needs the plan gate on for the selected
 * team (see {@link setSharedTeamPlanGate}); a session left open by an earlier
 * test is wrapped up and closed first, since that hides the plan composer.
 */
export async function openComposer(page: Page): Promise<void> {
  await new ClockPage(page).ensureClockedOut();
  await composerEditor(page).waitFor({ state: 'visible', timeout: 20000 });
}

/** The plan composer's submit button ("Publish" when it resumed a draft). */
export function postButton(page: Page): Locator {
  return page.getByRole('button', { name: /(Post|Publish) plan and clock in/ });
}

/** Close the session a posted plan opened, so the next test starts clocked out. */
export async function clockOut(page: Page): Promise<void> {
  await new ClockPage(page).ensureClockedOut();
}

/** A message in the open inbox conversation, by the unique text in its body. */
export function inboxMessage(page: Page, uniqueText: string): Locator {
  return page.locator('[data-slot="superchat-message"]').filter({ hasText: uniqueText });
}

/** Start editing an own message; SuperChat folds Copy + Edit into its ⋯ menu. */
export async function editInboxMessage(page: Page, message: Locator): Promise<void> {
  await message.hover();
  await message.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit message' }).click();
}

/** The inbox's conversation list, whose header carries the page's filters. */
export function conversationList(page: Page): Locator {
  return page.locator('[data-slot="superchat-conversations"]');
}

/** One row per conversation in the inbox list. */
export function conversationRows(page: Page): Locator {
  return page.locator('[data-slot="superchat-conversation-list"] [role="listitem"]');
}

/** The inbox search box (in the list header once the inbox is on screen). */
export function inboxSearch(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Search posts' });
}

/**
 * Go to the Huddle inbox and open the conversation holding the post whose body
 * contains `query`. Searching narrows the inbox to that conversation, so
 * whichever grouping is active, it is the first one listed. Retried because the
 * post can reach the feed (DDP or the REST fallback) after the page renders.
 *
 * `message` defaults to the message whose visible text contains `query`; pass
 * another locator when the match is only in markup (e.g. an image's src).
 */
export async function openPostInInbox(
  page: Page,
  query: string,
  message: Locator = inboxMessage(page, query).first(),
): Promise<Locator> {
  if (!new URL(page.url()).pathname.endsWith('/app/huddle')) await page.goto('/app/huddle');
  await inboxSearch(page).fill(query);

  await expect(async () => {
    await conversationRows(page).locator('button').first().click({ timeout: 2000 });
    await expect(message).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
  return message;
}

/** Pick how the inbox groups posts into conversations. */
export async function groupInboxBy(
  page: Page,
  option: 'Session' | 'Day' | 'Person' | 'Ticket',
): Promise<void> {
  await page.getByRole('button', { name: /^Group by:/ }).click();
  await page.getByRole('menuitem', { name: option }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Group by: ${option}` })).toBeVisible();
}

/** The message box at the bottom of the open inbox conversation. */
export function inboxComposer(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Message', exact: true });
}

/** Send what's in the inbox's message box. */
export async function sendFromInbox(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send message' }).click();
}

/** Post through the Huddle inbox's message box. */
export async function postFromHuddle(page: Page, text: string): Promise<void> {
  if (!new URL(page.url()).pathname.endsWith('/app/huddle')) await page.goto('/app/huddle');
  await inboxComposer(page).fill(text);
  await sendFromInbox(page);
}

/**
 * Create a post straight through the API (the same `huddle.createPost` call
 * the app makes), for specs that need one to exist rather than to test writing
 * it. `postDate` ("YYYY-MM-DD") picks which day/session conversation it joins;
 * `clockEventId` links it to one of the caller's own clock sessions.
 */
export async function seedPost(
  page: Page,
  params: { teamId: string; text: string; postDate?: string; clockEventId?: string },
): Promise<string> {
  const { status, body } = await page.evaluate(async ({ teamId, text, postDate, clockEventId }) => {
    const token = localStorage.getItem('meteor_resume_token');
    const res = await fetch('/api/huddle_createPost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        teamId,
        content: { text, mentions: [] },
        postDate,
        clockEventId,
      }),
    });
    return { status: res.status, body: (await res.json()) as { result?: { id: string } } };
  }, params);
  if (!body.result?.id) throw new Error(`seedPost failed (HTTP ${status})`);
  return body.result.id;
}

/**
 * Insert a clock session straight into the test DB (as the timesheet specs
 * do), so a post can be linked to a shift without driving the clock UI.
 * `endTime: null` makes it live — pair with {@link deleteClockSession}.
 */
export async function seedClockSession(params: {
  userId: string;
  teamId: string;
  startTime: number;
  endTime: number | null;
}): Promise<string> {
  const { insertedId } = await withDb((db) =>
    db.collection('clockevents').insertOne({
      ...params,
      accumulatedTime:
        params.endTime == null ? 0 : Math.floor((params.endTime - params.startTime) / 1000),
    }),
  );
  return insertedId.toHexString();
}

export async function deleteClockSession(clockEventId: string): Promise<void> {
  const { ObjectId } = await import('mongodb');
  await withDb((db) => db.collection('clockevents').deleteOne({ _id: new ObjectId(clockEventId) }));
}

/**
 * Attach a file through one of the composer's hidden file inputs and wait for
 * its chip to appear.
 *
 * `setInputFiles` on the hidden input rather than clicking the visible button
 * first: the click only forwards to the same input, and a real OS file dialog
 * isn't drivable anyway.
 */
export async function attachFile(page: Page, kind: 'image' | 'doc' | 'video'): Promise<void> {
  const accept = {
    image: 'input[type="file"][accept="image/*"]',
    doc: 'input[type="file"][accept=".pdf,.doc,.docx,.txt"]',
    video: 'input[type="file"][accept="video/*"]',
  }[kind];

  const chipsBefore = await attachmentChipCount(page);
  await page.locator(accept).setInputFiles(FIXTURE[kind]);

  // Video goes through a TUS upload of a ~770KB fixture, which is slower than
  // the single multipart POST images and docs take.
  await expect
    .poll(() => attachmentChipCount(page), { timeout: kind === 'video' ? 60000 : 20000 })
    .toBe(chipsBefore + 1);
}

/** How many attachment chips the composer is currently showing. */
export function attachmentChipCount(page: Page): Promise<number> {
  return page.locator('button[aria-label^="Remove attachment"]').count();
}

/**
 * Paste image files into the composer, the way ⌘V of a screenshot does.
 *
 * Playwright can't put an image on the real OS clipboard, so this dispatches
 * the `paste` event the browser would: a `ClipboardEvent` carrying a
 * `DataTransfer` of `File`s, fired at the ProseMirror surface. The composer's
 * handler is a *capture*-phase listener on the `.markdown-editor` wrapper, so
 * dispatching at the inner target still reaches it on the way down — exactly
 * the ordering the real thing relies on to beat ProseMirror's own handler.
 */
export async function pasteFiles(
  page: Page,
  files: Array<{ fixture: string; name: string; type: string }>,
): Promise<void> {
  const payload = files.map((f) => ({
    base64: fs.readFileSync(f.fixture).toString('base64'),
    name: f.name,
    type: f.type,
  }));

  await page.evaluate(async (items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const blob = await (await fetch(`data:${item.type};base64,${item.base64}`)).blob();
      transfer.items.add(new File([blob], item.name, { type: item.type }));
    }
    const target = document.querySelector('.markdown-editor .ProseMirror');
    if (!target) throw new Error('composer editor not found');
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, payload);
}

/**
 * Drag-and-drop files onto the editor.
 *
 * The drop path is the one Kerebron's media plugin used to win outright: paste
 * was intercepted but drop was not, so a dropped screenshot became a base64
 * `data:` URL inline in the post — several MB of markdown that the API rejects.
 * `dragover` is dispatched first because a drop the browser hasn't been told to
 * accept never fires.
 */
export async function dropFiles(
  page: Page,
  files: Array<{ fixture?: string; text?: string; name: string; type: string }>,
): Promise<void> {
  const payload = files.map((f) => ({
    // `text` builds a file with no fixture on disk — enough to exercise the
    // type and size checks, which never look at the bytes.
    base64: f.fixture
      ? fs.readFileSync(f.fixture).toString('base64')
      : Buffer.from(f.text ?? '').toString('base64'),
    name: f.name,
    type: f.type,
  }));

  await page.evaluate(async (items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const blob = await (await fetch(`data:${item.type};base64,${item.base64}`)).blob();
      transfer.items.add(new File([blob], item.name, { type: item.type }));
    }
    const target = document.querySelector('.markdown-editor .ProseMirror');
    if (!target) throw new Error('composer editor not found');
    const box = target.getBoundingClientRect();
    const init = {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
      clientX: box.left + 20,
      clientY: box.top + 10,
    };
    target.dispatchEvent(new DragEvent('dragenter', init));
    target.dispatchEvent(new DragEvent('dragover', init));
    target.dispatchEvent(new DragEvent('drop', init));
  }, payload);
}

/** Paste plain text, to prove the image interception leaves normal pastes alone. */
export async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', value);
    const target = document.querySelector('.markdown-editor .ProseMirror');
    if (!target) throw new Error('composer editor not found');
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, text);
}

/** Pick a team member in the @Mention menu. */
export async function mentionMember(page: Page, memberName: string): Promise<void> {
  await page.getByRole('button', { name: '@Mention', exact: true }).click();
  await page.getByTestId('mention-menu').waitFor({ state: 'visible', timeout: 10000 });
  await page
    .getByTestId('mention-menu')
    .getByRole('menuitem')
    .filter({ hasText: memberName })
    .first()
    .click();
  await expect(page.locator(`button[aria-label="Remove mention of ${memberName}"]`)).toBeVisible();
}

/** Pick a ticket in the Ticket menu, searching by title. */
export async function attachTicket(page: Page, ticketTitle: string): Promise<void> {
  await page.getByRole('button', { name: 'Ticket', exact: true }).click();
  await page.getByTestId('ticket-picker-menu').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByPlaceholder('Search tickets...').fill(ticketTitle);
  await page
    .getByTestId('ticket-picker-menu')
    .getByRole('menuitem')
    .filter({ hasText: ticketTitle })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Remove ticket' })).toBeVisible();
}

/**
 * Post the plan and wait for the clock-in it triggers: the composer flips to
 * the wrap-up prompt once the post has landed and the session is open.
 */
export async function submitPost(page: Page): Promise<void> {
  await postButton(page).click();
  await page.getByText('Wrap up before you clock out').waitFor({ timeout: 30000 });
}
