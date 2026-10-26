/**
 * Clearing what was stored against a bare Redmine issue number (#736).
 *
 * Runs against a database of its own, so it never touches the board entries
 * and prefs the other suites set up in the shared test database.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';

import { clearBareRedmineData } from '../server/redmine-cleanup-736';

let client: MongoClient;
let db: Db;
const HOST = 'redmine0.os.mieweb.org';

beforeAll(async () => {
  client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/timehuddle_test');
  await client.connect();
  db = client.db('timehuddle_cleanup_736_test');
});

afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});

beforeEach(async () => {
  await db.dropDatabase();
  await db.collection('my_board').insertMany([
    { userId: 'u1', sourceId: 'redmine', ticketId: '209' },
    { userId: 'u1', sourceId: 'huddle', ticketId: 't1' },
  ]);
  await db.collection('redmine_issue_prefs').insertMany([
    { userId: 'u1', issueId: 209, state: 'pinned' },
    { userId: 'u1', issueId: 210, state: 'removed' },
    { userId: 'u1', issueId: 211, state: 'dismissed' },
  ]);
  await db.collection('attachments').insertMany([
    { url: 'https://a', attachedTo: { kind: 'redmine', id: '209' } },
    { url: 'https://b', attachedTo: { kind: 'ticket', id: 't1' } },
  ]);
  await db.collection('tickets').insertMany([
    { title: 'old link', linkedIssue: { source: 'redmine', id: '209' } },
    { title: 'new link', linkedIssue: { source: 'redmine', id: '210', host: 'other.example' } },
    { title: 'no link' },
  ]);
  await db.collection('workitems').insertOne({ userId: 'u1', source: 'redmine', ticketId: '209' });
});

describe('clearBareRedmineData (#736)', () => {
  it('clears bare-issue board entries, pins, removals and attachments', async () => {
    const cleared = await clearBareRedmineData(db, { redmineHost: HOST });

    expect(cleared).toEqual({
      boardEntries: 1,
      prefs: 2,
      hidesKept: 0,
      attachments: 1,
      linksGivenHost: 1,
    });
    expect(await db.collection('my_board').find({}, { projection: { _id: 0 } }).toArray()).toEqual([
      { userId: 'u1', sourceId: 'huddle', ticketId: 't1' },
    ]);
    // A dismissal still hides the issue from the search suggestions.
    expect(await db.collection('redmine_issue_prefs').distinct('state')).toEqual(['dismissed']);
    expect(await db.collection('attachments').distinct('attachedTo.kind')).toEqual(['ticket']);
  });

  it('keeps the hide a pinned or removed issue carries, aged from its dismissal', async () => {
    const dismissedAt = new Date('2026-10-20T12:00:00Z');
    await db.collection('redmine_issue_prefs').insertMany([
      { userId: 'u1', issueId: 300, state: 'pinned', dismissedAt, assignedToMeAtDismissal: true },
      { userId: 'u1', issueId: 301, state: 'removed', dismissedAt },
    ]);

    const cleared = await clearBareRedmineData(db, { redmineHost: HOST });

    expect(cleared).toMatchObject({ prefs: 2, hidesKept: 2 });
    const kept = await db
      .collection('redmine_issue_prefs')
      .find({ issueId: { $in: [300, 301] } }, { projection: { _id: 0, userId: 0 }, sort: { issueId: 1 } })
      .toArray();
    expect(kept).toEqual([
      { issueId: 300, state: 'dismissed', updatedAt: dismissedAt, assignedToMeAtDismissal: true },
      { issueId: 301, state: 'dismissed', updatedAt: dismissedAt },
    ]);
  });

  it('gives old links the Redmine host, and leaves links that have one', async () => {
    await clearBareRedmineData(db, { redmineHost: HOST });

    const hosts = await db
      .collection('tickets')
      .find({ linkedIssue: { $exists: true } }, { sort: { title: -1 } })
      .map((t) => t.linkedIssue.host)
      .toArray();
    expect(hosts).toEqual([HOST, 'other.example']);
  });

  it('leaves time logged on a bare issue alone', async () => {
    await clearBareRedmineData(db, { redmineHost: HOST });
    expect(await db.collection('workitems').countDocuments({ source: 'redmine' })).toBe(1);
  });

  it('changes nothing the second time', async () => {
    await clearBareRedmineData(db, { redmineHost: HOST });
    expect(await clearBareRedmineData(db, { redmineHost: HOST })).toEqual({
      boardEntries: 0,
      prefs: 0,
      hidesKept: 0,
      attachments: 0,
      linksGivenHost: 0,
    });
  });

  it('gives no host when Redmine has no address', async () => {
    const cleared = await clearBareRedmineData(db, { redmineHost: null });
    expect(cleared.linksGivenHost).toBe(0);
  });
});
