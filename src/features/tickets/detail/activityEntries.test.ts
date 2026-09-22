import { describe, expect, it } from 'vitest';

import type { ActivityLogItem, RedmineJournal, TicketSession } from '../../../lib/api';

import { fromHuddleEvents, fromJournals, fromSessions, mergeByTime } from './activityEntries';

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

describe('mergeByTime', () => {
  it('orders every kind newest first', () => {
    const merged = mergeByTime(
      fromHuddleEvents([event('old', 'ticket.created', '2026-09-20T09:00:00Z')]),
      fromHuddleEvents([event('new', 'ticket.updated', '2026-09-21T09:00:00Z')]),
    );
    expect(merged.map((e) => e.id)).toEqual(['event:new', 'event:old']);
  });
});
