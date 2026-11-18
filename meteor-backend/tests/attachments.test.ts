/**
 * Attachments — wormhole REST integration tests.
 *
 * A Redmine issue takes no attachments of its own since #736: work on one is
 * carried by a TimeHuddle ticket, and attachments go on that.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser } from './helpers';

const USER = { name: 'Attach User', email: 'wh-attach-user@test.dev', password: 'Password1!' };
const ISSUE_ID = '424242';

let jwt: string;
let userId: string;

beforeAll(async () => {
  await purgeUser(USER.email);
  const auth = await createUserAndGetJwt(USER);
  jwt = auth.jwt;
  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('attachments').deleteMany({ addedBy: userId });
  await db.collection('pulsevault_reservations').deleteMany({ userId });
  await purgeUser(USER.email);
  await closeDb();
});

describe('attachments on a Redmine issue (wormhole, #736)', () => {
  it('lists none: Redmine is not an attachment kind', async () => {
    const res = await wormhole('attachments.list', { kind: 'redmine', id: ISSUE_ID }, jwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid kind/i);
  });

  it('adds none, and stores nothing', async () => {
    const res = await wormhole(
      'attachments.add',
      {
        url: 'https://example.com/spec',
        type: 'link',
        attachedTo: { kind: 'redmine', id: ISSUE_ID },
      },
      jwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid attachedTo.kind/i);

    const db = await getDb();
    const stored = await db.collection('attachments').findOne({ 'attachedTo.id': ISSUE_ID });
    expect(stored).toBeNull();
  });

  it('reserves no Pulse upload for one', async () => {
    const res = await wormhole(
      'pulsevault.reserve',
      { destination: { kind: 'redmine', id: ISSUE_ID } },
      jwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Unknown Pulse destination/i);
  });

  it('rejects a numeric id, which list would never match', async () => {
    const res = await wormhole(
      'attachments.add',
      { url: 'https://example.com/spec', type: 'link', attachedTo: { kind: 'ticket', id: 424242 } },
      jwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/attachedTo is required/i);
  });
});

// One video per target (huddle-server §12): the unique index
// attachments_video_target_unique, created at startup, turns a replay into
// the attachment already there. Huddle tickets aren't gated, so any id works.
describe('a video lands on a ticket once (idempotent attachments)', () => {
  const TICKET = 'pr3-s1-idempotent-ticket';
  const OTHER_TICKET = 'pr3-s1-idempotent-other';
  const VIDEO_URL = '/pulsevault/artifacts/0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';
  const LINK_URL = 'https://example.com/pr3-s1-spec';

  type Added = { attachment: { id: string; addedAt: string } };
  const add = (url: string, type: string, id: string) =>
    wormhole<Added>('attachments.add', { url, type, attachedTo: { kind: 'ticket', id } }, jwt);

  it('has the unique index on videos only', async () => {
    const db = await getDb();
    const index = (await db.collection('attachments').indexes()).find(
      (i) => i.name === 'attachments_video_target_unique',
    );
    expect(index).toMatchObject({
      key: { url: 1, 'attachedTo.kind': 1, 'attachedTo.id': 1 },
      unique: true,
      partialFilterExpression: { type: 'video' },
    });
  });

  it('a replayed video returns the first attachment and stores one', async () => {
    const first = await add(VIDEO_URL, 'video', TICKET);
    const replay = await add(VIDEO_URL, 'video', TICKET);
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(replay.result.attachment.id).toBe(first.result.attachment.id);
    expect(replay.result.attachment.addedAt).toBe(first.result.attachment.addedAt);

    const db = await getDb();
    const stored = await db
      .collection('attachments')
      .countDocuments({ type: 'video', url: VIDEO_URL, 'attachedTo.kind': 'ticket', 'attachedTo.id': TICKET });
    expect(stored).toBe(1);
  });

  it('the same video on another ticket is its own attachment', async () => {
    const res = await add(VIDEO_URL, 'video', OTHER_TICKET);
    expect(res.ok).toBe(true);
    const db = await getDb();
    const stored = await db.collection('attachments').countDocuments({
      type: 'video',
      url: VIDEO_URL,
      'attachedTo.kind': 'ticket',
      'attachedTo.id': { $in: [TICKET, OTHER_TICKET] },
    });
    expect(stored).toBe(2);
  });

  it('two identical link attachments are both kept', async () => {
    const first = await add(LINK_URL, 'link', TICKET);
    const second = await add(LINK_URL, 'link', TICKET);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.result.attachment.id).not.toBe(first.result.attachment.id);

    const db = await getDb();
    const stored = await db
      .collection('attachments')
      .countDocuments({ type: 'link', url: LINK_URL, 'attachedTo.kind': 'ticket', 'attachedTo.id': TICKET });
    expect(stored).toBe(2);
  });
});
