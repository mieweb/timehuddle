import { describe, expect, it } from 'vitest';

import {
  boardEntryKeys,
  displaySourceId,
  isOnBoard,
  linkedIssueKey,
  mergeLinked,
} from './linkedTickets';
import type { UnifiedLinkedIssue, UnifiedTicket } from './types';

const linkTo = (id: string): UnifiedLinkedIssue => ({
  sourceId: 'redmine',
  id,
  ref: `#${id}`,
  status: null,
  assignee: null,
});

const huddle = (id: string, linked: UnifiedLinkedIssue | null = null): UnifiedTicket =>
  ({
    key: `huddle:${id}`,
    sourceId: 'huddle',
    id,
    status: { native: 'open', isClosed: false },
    assignees: [{ id: 'u1', name: 'Ada' }],
    linked,
  }) as UnifiedTicket;

const redmine = (id: string, extra: Partial<UnifiedTicket> = {}): UnifiedTicket =>
  ({
    key: `redmine:${id}`,
    sourceId: 'redmine',
    id,
    status: { native: 'Resolved', isClosed: true },
    assignees: [{ id: '42', name: 'Jane Doe' }],
    linked: null,
    ...extra,
  }) as UnifiedTicket;

describe('linkedIssueKey', () => {
  it('is the row key of the linked issue, or null for an unlinked ticket', () => {
    expect(linkedIssueKey(huddle('a', linkTo('482')))).toBe('redmine:482');
    expect(linkedIssueKey(huddle('a'))).toBeNull();
  });
});

describe('isOnBoard', () => {
  it('is true for a ticket on the board itself, or through its linked issue', () => {
    expect(isOnBoard(huddle('a'), new Set(['huddle:a']))).toBe(true);
    expect(isOnBoard(huddle('a', linkTo('482')), new Set(['redmine:482']))).toBe(true);
    expect(isOnBoard(huddle('a', linkTo('482')), new Set(['huddle:b']))).toBe(false);
  });
});

describe('boardEntryKeys', () => {
  it('lists every entry that puts the ticket on the board, so removal takes them all', () => {
    const linked = huddle('a', linkTo('482'));
    expect(boardEntryKeys(linked, new Set(['huddle:a', 'redmine:482']))).toEqual([
      'huddle:a',
      'redmine:482',
    ]);
    expect(boardEntryKeys(linked, new Set(['redmine:482']))).toEqual(['redmine:482']);
    expect(boardEntryKeys(linked, new Set())).toEqual([]);
  });
});

describe('displaySourceId', () => {
  it('is the linked issue\u2019s source for a linked ticket, and the ticket\u2019s own otherwise', () => {
    expect(displaySourceId(huddle('a', linkTo('482')))).toBe('redmine');
    expect(displaySourceId(huddle('a'))).toBe('huddle');
    expect(displaySourceId(redmine('7'))).toBe('redmine');
  });
});

describe('mergeLinked', () => {
  it('leaves a list with no links untouched', () => {
    const tickets = [huddle('a'), redmine('7')];
    expect(mergeLinked(tickets)).toEqual(tickets);
  });

  it('shows the linked issue on its ticket and drops the issue row', () => {
    const [merged, ...rest] = mergeLinked([huddle('a', linkTo('482')), redmine('482')]);
    expect(rest).toEqual([]);
    expect(merged.key).toBe('huddle:a');
    // The linked issue's status replaces the ticket's, so it decides Open/Closed.
    expect(merged.status).toEqual({ native: 'Resolved', isClosed: true });
    expect(merged.linked).toEqual({
      ...linkTo('482'),
      status: { native: 'Resolved', isClosed: true },
      assignee: { id: '42', name: 'Jane Doe' },
    });
    // People are namespaced per source, so the ticket keeps its own assignees.
    expect(merged.assignees).toEqual([{ id: 'u1', name: 'Ada' }]);
  });

  it('keeps the ticket as it is when the viewer cannot read the linked issue', () => {
    const ticket = huddle('a', linkTo('482'));
    expect(mergeLinked([ticket, redmine('7')])).toEqual([ticket, redmine('7')]);
  });

  it('never shows an issue that was fetched only for a link', () => {
    const orphan = redmine('900', { linkOnly: true });
    expect(mergeLinked([huddle('a'), orphan])).toEqual([huddle('a')]);
  });

  it('lets two tickets link to the same issue', () => {
    const merged = mergeLinked([
      huddle('a', linkTo('482')),
      huddle('b', linkTo('482')),
      redmine('482', { linkOnly: true }),
    ]);
    expect(merged.map((t) => t.key)).toEqual(['huddle:a', 'huddle:b']);
    expect(merged.every((t) => t.status.isClosed)).toBe(true);
  });
});
