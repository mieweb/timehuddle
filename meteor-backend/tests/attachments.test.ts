/**
 * Attachments — wormhole REST integration tests.
 *
 * A Redmine issue's attachments are stored in TimeHuddle under kind `redmine`,
 * gated on the caller's own Redmine key seeing the issue. The fixture user has
 * no linked Redmine account, so every `redmine` call must stop at that check;
 * a Huddle ticket keeps working as before.
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

describe('attachments on a Redmine issue (wormhole)', () => {
  it('refuses to list them without a linked Redmine account', async () => {
    const res = await wormhole('attachments.list', { kind: 'redmine', id: ISSUE_ID }, jwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Redmine/i);
  });

  it('refuses to add one without a linked Redmine account, and stores nothing', async () => {
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
    expect(res.error).toMatch(/Redmine/i);

    const db = await getDb();
    const stored = await db.collection('attachments').findOne({ 'attachedTo.id': ISSUE_ID });
    expect(stored).toBeNull();
  });

  it('refuses to reserve a Pulse upload for the issue, and records no reservation', async () => {
    const res = await wormhole(
      'pulsevault.reserve',
      { target: 'redmine', ticketId: ISSUE_ID },
      jwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Redmine/i);

    const db = await getDb();
    const reservation = await db
      .collection('pulsevault_reservations')
      .findOne({ userId, ticketId: ISSUE_ID });
    expect(reservation).toBeNull();
  });

  it('rejects a numeric issue id, which list would never match', async () => {
    const res = await wormhole(
      'attachments.add',
      { url: 'https://example.com/spec', type: 'link', attachedTo: { kind: 'redmine', id: 424242 } },
      jwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/attachedTo is required/i);
  });

  it('rejects an id that is not a Redmine issue id', async () => {
    const res = await wormhole('attachments.list', { kind: 'redmine', id: 'abc' }, jwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});
