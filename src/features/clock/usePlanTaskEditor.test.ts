import { describe, expect, it } from 'vitest';

import type { SessionPlanItem } from '../../lib/api';
import { planItemsFor } from './usePlanTaskEditor';

const ITEMS = [
  { id: 'a', ticketId: 't1', title: 'TH-1: Alpha', checked: false, seconds: 0, runningSince: null },
  { id: 'b', ticketId: 't2', title: 'TH-2: Bravo', checked: true, seconds: 0, runningSince: null },
  { id: 'c', text: '**Call** [@Pam](/app/profile/u1)', checked: false },
] satisfies SessionPlanItem[];

describe('planItemsFor (#886)', () => {
  it('finds a formatted line by the words it shows', () => {
    expect(planItemsFor(ITEMS, { text: 'Call Pam' }).map((item) => item.id)).toEqual(['c']);
  });

  it('finds every ticket of a line, in order, and none it does not hold', () => {
    expect(planItemsFor(ITEMS, { ticketIds: ['t2', 'x', 't1'] }).map((item) => item.id)).toEqual([
      'b',
      'a',
    ]);
    expect(planItemsFor(ITEMS, { text: 'Written in the wrap-up' })).toEqual([]);
  });
});
