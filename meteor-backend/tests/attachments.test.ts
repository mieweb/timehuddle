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
