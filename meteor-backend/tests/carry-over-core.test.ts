/**
 * Unit tests for carry-over-core (server/carry-over-core.js): which plan items
 * leave Pinned at clock-out.
 */
import { describe, it, expect } from 'vitest';

import { releasedTicketIds } from '../server/carry-over-core';

const ticket = (ticketId: string, checked: boolean) => ({ id: `i-${ticketId}`, ticketId, checked });

describe('releasedTicketIds', () => {
  it('releases the checked tickets, in plan order, and keeps the unchecked ones', () => {
    const plan = [ticket('a', true), ticket('b', false), ticket('c', true), ticket('d', true)];
    expect(releasedTicketIds(plan)).toEqual(['a', 'c', 'd']);
  });

  it('ignores lines of text, and releases nothing without a plan', () => {
    expect(releasedTicketIds([{ id: 't', text: 'Review', checked: true }])).toEqual([]);
    expect(releasedTicketIds(undefined)).toEqual([]);
    expect(releasedTicketIds(null)).toEqual([]);
    expect(releasedTicketIds([null, { checked: true }, { ticketId: '', checked: true }])).toEqual(
      [],
    );
  });

  it('releases a ticket once, even if the plan lists it twice', () => {
    expect(releasedTicketIds([ticket('a', true), ticket('a', true)])).toEqual(['a']);
  });
});
