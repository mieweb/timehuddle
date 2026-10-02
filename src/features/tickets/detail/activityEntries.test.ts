import { describe, expect, it } from 'vitest';

import type {
  ActivityLogItem,
  RedmineJournal,
  RedmineTimeEntry,
  TicketSession,
} from '../../../lib/api';

import {
  fromHuddleEvents,
  fromJournals,
  fromRedmineTimeEntries,
  fromSessions,
  mergeByTime,
} from './activityEntries';

const event = (id: string, type: string, occurredAt: string, payload = {}): ActivityLogItem =>
  ({
    id,
    userId: 'u1',
    type,
    actor: { id: 'u1', name: 'Priya' },
    payload,
    occurredAt,
    source: 'timehuddle',
  }) as ActivityLogItem;

describe('fromHuddleEvents', () => {
  it('labels known event types', () => {
    const [created, status] = fromHuddleEvents([
      event('a', 'ticket.created', '2026-09-21T09:00:00Z'),
      event('b', 'ticket.status_changed', '2026-09-21T10:00:00Z', { status: 'closed' }),
    ]);
    expect(created).toMatchObject({
      id: 'event:a',
      actorName: 'Priya',
      text: 'created this ticket',
    });
    expect(status.text).toBe('changed status to closed');
  });
});

describe('fromSessions', () => {
  const start = Date.parse('2026-09-21T10:00:00Z');

  it('shows the logged duration for a finished session', () => {
    const session: TicketSession = {
      id: 's1',
      date: '2026-09-21',
      startTime: start,
      endTime: start + 4_800_000,
      durationSeconds: 4800,
    };
    const [entry] = fromSessions([session], 'You');
    expect(entry).toMatchObject({
      id: 'session:s1',
      actorName: 'You',
      text: 'logged 1h 20m',
      kind: 'session',
    });
    expect(entry.detail).toContain('–');
  });

  it('marks a running session', () => {
    const [entry] = fromSessions(
      [{ id: 's2', date: '2026-09-21', startTime: start, endTime: null, durationSeconds: null }],
      'You',
    );
    expect(entry.text).toBe('started a timer (running)');
    expect(entry.detail).toMatch(/^Since /);
  });
});

describe('fromJournals', () => {
  const journal = (overrides: Partial<RedmineJournal>): RedmineJournal => ({
    id: 1,
    user: { id: 8, name: 'Priya Patel' },
    createdAt: '2026-09-21T10:00:00.000Z',
    notes: '',
    changes: [],
    ...overrides,
  });

  it('describes field changes in one sentence', () => {
    const [entry] = fromJournals([
      journal({
        changes: [
          { field: 'status', from: 'New', to: 'Closed' },
          { field: 'assignee', from: null, to: 'Riley' },
          { field: 'description', from: null, to: null },
        ],
      }),
    ]);
    expect(entry.text).toBe('changed status from New to Closed, assignee to Riley, description');
    expect(entry.kind).toBe('event');
  });

  it('treats a notes-only journal as a comment', () => {
    const [entry] = fromJournals([journal({ notes: 'Looks good' })]);
    expect(entry).toMatchObject({ text: 'commented', detail: 'Looks good', kind: 'comment' });
  });

  it('skips a journal with no timestamp', () => {
    expect(fromJournals([journal({ createdAt: null })])).toEqual([]);
  });
});

describe('fromRedmineTimeEntries', () => {
  const entry = (overrides: Partial<RedmineTimeEntry> = {}): RedmineTimeEntry => ({
    id: 900,
    user: { id: 42, name: 'Jane Doe' },
    hours: 1.5,
    activity: { id: 9, name: 'Development' },
    comments: 'Paired on the fix',
    spentOn: '2026-09-28',
    createdAt: '2026-09-28T16:20:00.000Z',
    ...overrides,
  });

  it('reads as time logged in Redmine, with the activity, day and comment', () => {
    const [time] = fromRedmineTimeEntries([entry()]);
    expect(time).toMatchObject({
      id: 'time:900',
      at: '2026-09-28T16:20:00.000Z',
      actorName: 'Jane Doe',
      text: 'logged 1h 30m in Redmine',
      kind: 'time',
      mine: false,
    });
    expect(time.detail).toMatch(/^Development, for .+ — Paired on the fix$/);
  });

  it("marks the viewer's own entries", () => {
    const [mine, theirs] = fromRedmineTimeEntries(
      [entry(), entry({ id: 901, user: { id: 7, name: 'Sam' } })],
      42,
    );
    expect(mine.mine).toBe(true);
    expect(theirs.mine).toBe(false);
  });

  it('falls back to the day it was for, and skips undated entries', () => {
    const entries = fromRedmineTimeEntries([
      entry({ createdAt: null, comments: '', activity: null }),
      entry({ id: 2, createdAt: null, spentOn: null }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].at).toBe(new Date('2026-09-28T12:00:00').toISOString());
    expect(entries[0].detail).toMatch(/^for /);
  });
});

describe('the "mine" marker', () => {
  it("marks the viewer's journals and always their own sessions", () => {
    const journals = [
      {
        id: 1,
        user: { id: 42, name: 'Me' },
        createdAt: '2026-09-01T00:00:00Z',
        notes: 'hi',
        changes: [],
      },
      {
        id: 2,
        user: { id: 7, name: 'Sam' },
        createdAt: '2026-09-01T00:00:00Z',
        notes: 'yo',
        changes: [],
      },
    ] as RedmineJournal[];
    expect(fromJournals(journals, 42).map((j) => j.mine)).toEqual([true, false]);
    expect(fromJournals(journals).map((j) => j.mine)).toEqual([false, false]);
    const session = {
      id: 's',
      startTime: 0,
      endTime: 60_000,
      durationSeconds: 60,
    } as TicketSession;
    expect(fromSessions([session], 'You')[0].mine).toBe(true);
  });
});

describe('mergeByTime', () => {
  it('orders every kind newest first', () => {
    const merged = mergeByTime(
      fromHuddleEvents([event('old', 'ticket.created', '2026-09-20T09:00:00Z')]),
      fromHuddleEvents([event('new', 'ticket.updated', '2026-09-21T09:00:00Z')]),
    );
    expect(merged.map((e) => e.id)).toEqual(['event:new', 'event:old']);
  });
});
