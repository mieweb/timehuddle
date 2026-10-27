import { describe, expect, it } from 'vitest';

import type { ConversationEntry } from '@timehuddle/ticket-sources';

import type { ActivityLogItem, TicketSession } from '../../../lib/api';

import { fromConversation, fromHuddleEvents, fromSessions, mergeByTime } from './activityEntries';

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

  it('says which Redmine issue a link change was about', () => {
    const updated = (id: string, payload: Record<string, unknown>) =>
      event(id, 'ticket.updated', '2026-09-21T09:00:00Z', payload);
    const texts = fromHuddleEvents([
      updated('a', { action: 'linked', issueId: '482' }),
      updated('b', { action: 'relinked', issueId: '500', previousIssueId: '482' }),
      updated('c', { action: 'unlinked', previousIssueId: '500' }),
      updated('d', { action: 'edited' }),
    ]).map((entry) => entry.text);
    expect(texts).toEqual([
      'linked this ticket to Redmine #482',
      "moved this ticket's link from Redmine #482 to Redmine #500",
      'unlinked this ticket from Redmine #500',
      'updated this ticket',
    ]);
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
      mine: true,
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

describe('fromConversation (#757)', () => {
  const jane = { id: '42', name: 'Jane Doe' };
  const sam = { id: '7', name: 'Sam' };
  const at = '2026-09-21T10:00:00.000Z';
  const conversation: ConversationEntry[] = [
    {
      kind: 'comment',
      id: 'journal:1:note',
      author: jane,
      at,
      text: { text: 'Looks good', format: 'textile' },
    },
    {
      kind: 'change',
      id: 'journal:1:change:0',
      author: jane,
      at,
      field: 'status',
      from: 'New',
      to: 'Closed',
    },
    { kind: 'change', id: 'journal:1:change:1', author: jane, at, field: 'assignee', to: 'Riley' },
    { kind: 'change', id: 'journal:1:change:2', author: jane, at, field: 'description' },
    {
      kind: 'comment',
      id: 'journal:2:note',
      author: sam,
      at,
      text: { text: 'Thanks', format: 'textile' },
    },
    {
      kind: 'time',
      id: 'time:900',
      author: jane,
      at: '2026-09-28T16:20:00.000Z',
      seconds: 5400,
      on: '2026-09-28',
      text: { text: 'Development — Paired on the fix', format: 'plain' },
    },
  ];

  it('reads changes and a comment made together as one entry', () => {
    const [together] = fromConversation(conversation, { source: 'Redmine' });
    expect(together).toMatchObject({
      id: 'outside:journal:1:note',
      actorName: 'Jane Doe',
      text: 'changed status from New to Closed, assignee to Riley, description',
      detail: 'Looks good',
      kind: 'event',
    });
  });

  it("keeps someone else's comment at the same moment apart, as a comment", () => {
    const entries = fromConversation(conversation, { source: 'Redmine' });
    expect(entries[1]).toMatchObject({
      actorName: 'Sam',
      text: 'commented',
      detail: 'Thanks',
      kind: 'comment',
    });
  });

  it('reads time as logged in the source, with its note and day', () => {
    const time = fromConversation(conversation, { source: 'Redmine' }).find(
      (e) => e.kind === 'time',
    );
    expect(time).toMatchObject({ id: 'outside:time:900', text: 'logged 1h 30m in Redmine' });
    expect(time?.detail).toMatch(/^Development — Paired on the fix, for /);
  });

  it("marks the viewer's own entries", () => {
    expect(
      fromConversation(conversation, { me: '42', source: 'Redmine' }).map((e) => e.mine),
    ).toEqual([true, false, true]);
    expect(fromConversation(conversation, { source: 'Redmine' }).every((e) => !e.mine)).toBe(true);
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
