/**
 * Huddle conversation topics (#866 M5) — the composer says where a post goes,
 * warns before sending one that won't show in the thread being read, and keeps
 * the draft when the workday closes while it is being written.
 *
 * Edge cases 7, 8 and 34 of the #866 plan.
 */
import { expect, test, type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { getUserIdByEmail, groupInboxBy, inboxComposer, sendFromInbox } from './helpers';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    return await fn(client.db());
  } finally {
    await client.close();
  }
}

function uniqueToken(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Today in the browser's (and test runner's) local time, YYYY-MM-DD. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The team's open workday id, opening one for today if none is. */
async function ensureOpenWorkday(teamId: string): Promise<string> {
  return withDb(async (db) => {
    const open = await db.collection('huddleConversations').findOne({ teamId, open: true });
    if (open) return open._id.toHexString();
    const { insertedId } = await db.collection('huddleConversations').insertOne({
      teamId,
      kind: 'workday',
      dateKey: todayKey(),
      open: true,
      closedAt: null,
      startedAt: new Date(),
      startedBy: null,
      createdAt: new Date(),
    });
    return insertedId.toHexString();
  });
}

/**
 * A closed workday dated `dateKey` holding one post, so its thread is listed.
 * Returns the workday's and the post's ids, for cleanup.
 */
async function seedClosedWorkday(params: {
  teamId: string;
  userId: string;
  dateKey: string;
  text: string;
}): Promise<{ workdayId: ObjectId; postId: ObjectId }> {
  return withDb(async (db) => {
    const workdayId = new ObjectId();
    await db.collection('huddleConversations').insertOne({
      _id: workdayId,
      teamId: params.teamId,
      kind: 'workday',
      dateKey: params.dateKey,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      closedAt: new Date(Date.now() - 60 * 60 * 1000),
      startedBy: params.userId,
      createdAt: new Date(),
    });
    const postId = new ObjectId();
    const createdAt = new Date(Date.now() - 90 * 60 * 1000);
    await db.collection('huddlePosts').insertOne({
      _id: postId,
      teamId: params.teamId,
      userId: params.userId,
      content: { text: params.text, mentions: [] },
      attachments: [],
      likes: [],
      commentCount: 0,
      conversationId: workdayId.toHexString(),
      createdAt,
      updatedAt: createdAt,
    });
    return { workdayId, postId };
  });
}

/** A teammate starts the next huddle behind this page's back: the open workday closes. */
async function startNextHuddleElsewhere(teamId: string): Promise<ObjectId> {
  return withDb(async (db) => {
    await db
      .collection('huddleConversations')
      .updateOne({ teamId, open: true }, { $set: { closedAt: new Date() }, $unset: { open: '' } });
    const { insertedId } = await db.collection('huddleConversations').insertOne({
      teamId,
      kind: 'workday',
      dateKey: todayKey(),
      open: true,
      closedAt: null,
      startedAt: new Date(),
      startedBy: 'a-teammate',
      createdAt: new Date(),
    });
    return insertedId;
  });
}

const sendWarning = (page: Page) => page.getByRole('alertdialog');

test.describe('Huddle conversation topics', () => {
  test.setTimeout(90000);

  let teamId: string;
  let userId: string;
  const cleanup: { conversations: ObjectId[]; posts: ObjectId[] } = {
    conversations: [],
    posts: [],
  };

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    teamId = await selectSharedTestTeam(page);
    userId = await getUserIdByEmail(TEST_USERS.owner1.email);
    await ensureOpenWorkday(teamId);
  });

  test.afterEach(async () => {
    await withDb(async (db) => {
      if (cleanup.posts.length) {
        await db.collection('huddlePosts').deleteMany({ _id: { $in: cleanup.posts } });
      }
      if (cleanup.conversations.length) {
        await db
          .collection('huddleConversations')
          .deleteMany({ _id: { $in: cleanup.conversations } });
      }
    });
    cleanup.posts = [];
    cleanup.conversations = [];
  });

  test('sending from a closed workday warns first; Cancel keeps the draft; Send goes to the open workday (rows 8, 34)', async ({
    page,
  }) => {
    const seeded = await seedClosedWorkday({
      teamId,
      userId,
      dateKey: '2026-01-05',
      text: uniqueToken('closed-day'),
    });
    cleanup.conversations.push(seeded.workdayId);
    cleanup.posts.push(seeded.postId);

    await page.goto('/app/huddle');
    await groupInboxBy(page, 'Conversation');
    await page
      .getByRole('button', { name: /Mon, Jan 5/ })
      .first()
      .click();

    // The composer names where the post will go: not this closed day.
    await expect(page.getByRole('button', { name: /^To: .*Open it$/ })).not.toHaveAccessibleName(
      /Jan 5/,
    );

    const draft = uniqueToken('from-closed');
    await inboxComposer(page).fill(draft);
    await sendFromInbox(page);
    await expect(sendWarning(page)).toContainText('closed when the next huddle started');

    await sendWarning(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(sendWarning(page)).toBeHidden();
    await expect(inboxComposer(page)).toHaveValue(draft);

    await sendFromInbox(page);
    await sendWarning(page).getByRole('button', { name: 'Send and open it' }).click();
    await expect(page.getByRole('log', { name: 'Messages' }).getByText(draft)).toBeVisible({
      timeout: 20000,
    });
    expect(new URL(page.url()).searchParams.get('conversation')).not.toBe(
      `conversation:${seeded.workdayId.toHexString()}`,
    );
    const sent = await withDb((db) =>
      db.collection('huddlePosts').findOne({ 'content.text': draft }),
    );
    if (sent) cleanup.posts.push(sent._id);
    expect(sent?.conversationId).not.toBe(seeded.workdayId.toHexString());
  });

  test('a workday that closes while the post is written keeps the draft and says why (row 7)', async ({
    page,
  }) => {
    await page.goto('/app/huddle');
    await groupInboxBy(page, 'Conversation');
    // Conversation grouping opens the open workday.
    const draft = uniqueToken('mid-draft');
    await inboxComposer(page).fill(draft);

    cleanup.conversations.push(await startNextHuddleElsewhere(teamId));
    await sendFromInbox(page);

    await expect(page.getByText(/That workday closed when the next huddle started/)).toBeVisible({
      timeout: 20000,
    });
    await expect(inboxComposer(page)).toHaveValue(draft);
    expect(
      await withDb((db) => db.collection('huddlePosts').countDocuments({ 'content.text': draft })),
    ).toBe(0);
  });
});
