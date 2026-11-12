/**
 * A member's accounts on other registered servers (#734 step 7), end to end
 * on the server against a stand-in Redmine: connecting one, its key locked to
 * the member and the server, the main link left alone, and a ticket carrying
 * an issue there read with that server's key.
 *
 * The stand-in is a small HTTP server in this process. The test backend must
 * reach it at SOURCES_TEST_SERVER (e.g. http://host.docker.internal:3997 for a
 * backend in Docker), and this process must listen on SOURCES_TEST_PORT
 * (3997). Without them the suite is skipped.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, createUserAndGetJwt, getDb, ObjectId, purgeUser, wormhole } from './helpers';

const SERVER = process.env.SOURCES_TEST_SERVER;
const PORT = Number(process.env.SOURCES_TEST_PORT ?? 0);
const USER = { name: 'Sources User', email: 'wh-sources@test.dev', password: 'Password1!' };
const GOOD_KEY = 'good-key';
const ISSUE = { id: 233, subject: 'Printer jams on page 2' };

describe.skipIf(!SERVER || !PORT)('accounts on other registered servers', () => {
  let redmine: Server;
  let jwt: string;
  let userId: string;
  const orgId = new ObjectId();
  const teamId = new ObjectId();
  const ticketId = new ObjectId();
  const host = SERVER ? new URL(SERVER).hostname : '';

  function startRedmine(): Promise<Server> {
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://stand-in').pathname;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.headers['x-redmine-api-key'] !== GOOD_KEY) return json(401, {});
      if (path === '/users/current.json') {
        return json(200, { user: { id: 7, login: 'ada', firstname: 'Ada', lastname: 'L' } });
      }
      if (path === `/issues/${ISSUE.id}.json`) {
        return json(200, {
          issue: {
            ...ISSUE,
            status: { id: 1, name: 'New', is_closed: false },
            project: { id: 1, name: 'Ops' },
            tracker: { id: 1, name: 'Bug' },
            author: { id: 7, name: 'Ada L' },
            custom_fields: [{ id: 3, name: 'Billable', value: 'Yes' }],
            created_on: '2026-10-01T10:00:00Z',
            updated_on: '2026-10-02T10:00:00Z',
            journals: [],
            attachments: [],
            allowed_statuses: [],
          },
        });
      }
      return json(404, {});
    });
    return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
  }

  beforeAll(async () => {
    redmine = await startRedmine();
    await purgeUser(USER.email);
    ({ jwt, userId } = await createUserAndGetJwt(USER));
    const db = await getDb();
    await db.collection('organizations').insertOne({
      _id: orgId,
      name: 'sources-org',
      slug: `sources-${orgId}`,
      sourcePrefixes: [{ host, prefix: 'OT', type: 'redmine', baseUrl: SERVER }],
    });
    await db
      .collection('teams')
      .insertOne({ _id: teamId, orgId: orgId.toHexString(), name: 'sources-team', members: [userId], admins: [] });
    await db.collection('tickets').insertOne({
      _id: ticketId,
      teamId: teamId.toHexString(),
      title: 'old title',
      createdAt: new Date(),
      linkedIssue: { source: 'redmine', id: String(ISSUE.id), host },
    });
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('redmine_links').deleteMany({ userId });
    await db.collection('tickets').deleteOne({ _id: ticketId });
    await db.collection('teams').deleteOne({ _id: teamId });
    await db.collection('organizations').deleteOne({ _id: orgId });
    await purgeUser(USER.email);
    await closeDb();
    await new Promise((resolve) => redmine.close(resolve));
  });

  it("refuses a server none of the member's orgs registered", async () => {
    const res = await wormhole('sources.connect', { server: 'https://elsewhere.example.com', apiKey: GOOD_KEY }, jwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/registered/);
  });

  it('lets an owner with no team connect', async () => {
    const owner = { name: 'Sources Owner', email: 'wh-sources-owner@test.dev', password: 'Password1!' };
    await purgeUser(owner.email);
    const { jwt: ownerJwt, userId: ownerId } = await createUserAndGetJwt(owner);
    const db = await getDb();
    await db.collection('org_members').insertOne({ orgId: orgId.toHexString(), userId: ownerId, role: 'owner' });
    const res = await wormhole('sources.connect', { server: SERVER, apiKey: GOOD_KEY }, ownerJwt);
    await db.collection('org_members').deleteMany({ userId: ownerId });
    await db.collection('redmine_links').deleteMany({ userId: ownerId });
    await purgeUser(owner.email);
    expect(res.ok).toBe(true);
  });

  it('lists the server with no key, and not yet connected', async () => {
    const res = await wormhole<{ servers: Record<string, unknown>[] }>('sources.list', {}, jwt);
    expect(res.ok).toBe(true);
    expect(res.result.servers).toEqual([
      expect.objectContaining({ host, prefix: 'OT', main: false, connected: false, rejected: false }),
    ]);
  });

  it('refuses a key the server rejects', async () => {
    const res = await wormhole('sources.connect', { server: SERVER, apiKey: 'wrong' }, jwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rejected/);
  });

  it('connects with a good key, locked to the member and the server, beside the main link', async () => {
    const res = await wormhole<{ host: string; connected: boolean }>(
      'sources.connect',
      { server: SERVER, apiKey: GOOD_KEY },
      jwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ host, connected: true });

    const db = await getDb();
    const rows = await db.collection('redmine_links').find({ userId }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ host, baseUrl: SERVER, redmineLogin: 'ada' });
    expect(String(rows[0].apiKey).startsWith('v2:')).toBe(true);
    expect(rows[0].apiKey).not.toContain(GOOD_KEY);

    // The main link is a different thing: still not connected.
    const status = await wormhole<{ connected: boolean }>('redmine.status', {}, jwt);
    expect(status.result.connected).toBe(false);
  });

  it("reads a carried issue on that server with the member's key for it", async () => {
    const res = await wormhole<{ record: { title: string; extra: { label: string; value: string }[] } }>(
      'tickets.outsideRecord',
      { ticketId: ticketId.toHexString() },
      jwt,
    );
    expect(res.error).toBeUndefined();
    expect(res.result.record.title).toBe(ISSUE.subject);
    expect(res.result.record.extra).toContainEqual({ label: 'Billable', value: 'Yes' });
  });

  it('lists the connection, and checks the saved key without returning it', async () => {
    const list = await wormhole<{ servers: Record<string, unknown>[] }>('sources.list', {}, jwt);
    expect(list.result.servers[0]).toMatchObject({ host, connected: true });
    expect(JSON.stringify(list.result)).not.toContain(GOOD_KEY);
    const check = await wormhole('sources.check', { server: SERVER }, jwt);
    expect(check.ok).toBe(true);
    expect(check.result).toMatchObject({ host, connected: true });
  });

  it('shows a key the server now refuses as rejected', async () => {
    const db = await getDb();
    const link = await db.collection('redmine_links').findOne({ userId, host });
    await db.collection('redmine_links').updateOne({ _id: link!._id }, { $set: { rejectedAt: new Date() } });
    const list = await wormhole<{ servers: Record<string, unknown>[] }>('sources.list', {}, jwt);
    expect(list.result.servers[0]).toMatchObject({ connected: false, rejected: true });
    await db.collection('redmine_links').updateOne({ _id: link!._id }, { $unset: { rejectedAt: '' } });
  });

  it('marks a key rejected even while it was being re-encrypted', async () => {
    const secret = process.env.SOURCE_KEYS_SECRET;
    if (!secret) return;
    const db = await getDb();
    // An old-format key the server no longer accepts: reading it rewrites it,
    // so what's stored has changed by the time the 401 comes back.
    const aesKey = createHash('sha256').update(secret, 'utf8').digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
    const body = Buffer.concat([cipher.update('stale-key', 'utf8'), cipher.final()]);
    const v1 = ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
    await db.collection('redmine_links').updateOne({ userId, host }, { $set: { apiKey: v1 } });

    const check = await wormhole('sources.check', { server: SERVER }, jwt);
    expect(check.ok).toBe(false);
    const link = await db.collection('redmine_links').findOne({ userId, host });
    expect(link?.apiKey).not.toBe(v1);
    expect(link?.rejectedAt).toBeTruthy();
    const back = await wormhole('sources.connect', { server: SERVER, apiKey: GOOD_KEY }, jwt);
    expect(back.ok).toBe(true);
  });

  it('disconnects that server only', async () => {
    const res = await wormhole('sources.disconnect', { server: SERVER }, jwt);
    expect(res.ok).toBe(true);
    const db = await getDb();
    expect(await db.collection('redmine_links').countDocuments({ userId })).toBe(0);

    const read = await wormhole('tickets.outsideRecord', { ticketId: ticketId.toHexString() }, jwt);
    expect(read.ok).toBe(false);
  });
});
