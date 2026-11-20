import { describe, expect, it } from 'vitest';

import { pinIndex, splitPinned } from './pinnedSections';
import type { UnifiedTicket } from './sources/types';

const ticket = (id: string, linkedIssue?: string) =>
  ({
    key: `huddle:${id}`,
    linked: linkedIssue
      ? { sourceId: 'redmine', id: linkedIssue, ref: null, status: null, assignee: null }
      : null,
  }) as unknown as UnifiedTicket;

describe('splitPinned', () => {
  it('lists pins in pin order and the rest in the sorted order', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => ticket(id));
    const { pinned, rest } = splitPinned([a, b, c, d], ['huddle:c', 'huddle:a']);
    expect(pinned).toEqual([c, a]);
    expect(rest).toEqual([b, d]);
  });

  it('skips pins with no row, such as one filtered out', () => {
    const a = ticket('a');
    expect(splitPinned([a], ['huddle:gone', 'huddle:a'])).toEqual({ pinned: [a], rest: [] });
  });
});

describe('pinIndex', () => {
  it("pins a ticket through its linked issue's entry, at the earliest place", () => {
    const carrier = ticket('a', '42');
    expect(pinIndex(carrier, ['huddle:x', 'redmine:42'])).toBe(1);
    expect(pinIndex(carrier, ['redmine:42', 'huddle:a'])).toBe(0);
    expect(pinIndex(carrier, ['huddle:x'])).toBe(-1);
  });
});
