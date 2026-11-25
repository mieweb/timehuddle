/**
 * Unit tests for session-plan-core (server/session-plan-core.js): today's
 * plan as session data, and touch-and-go check-off (M4, #886).
 */
import { describe, it, expect } from 'vitest';

import {
  MAX_ITEM_TEXT,
  mergePlan,
  planInput,
  touchAndGo,
  withChecked,
} from '../server/session-plan-core';

const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe('planInput', () => {
  it('keeps tickets and text in order, each once, trimmed', () => {
    expect(
      planInput([
        { ticketId: 't1' },
        { text: '  Call Ann ', checked: true },
        { ticketId: 't1' },
        { text: '' },
        { text: 'Call Ann' },
      ]),
    ).toEqual([{ ticketId: 't1' }, { text: 'Call Ann', checked: true }]);
  });

  it('refuses what is not a plan', () => {
    expect(planInput('nope')).toBeNull();
    expect(planInput([{ other: 1 }])).toBeNull();
    expect(planInput([{ text: 'x'.repeat(MAX_ITEM_TEXT + 1) }])).toBeNull();
  });
});

describe('mergePlan', () => {
  const previous = [
    { id: 'a', ticketId: 't1', checked: true },
    { id: 'b', text: 'Call Ann', checked: false },
  ];

  it('keeps an item’s id and check, and returns the new ones as added', () => {
    const { items, added } = mergePlan(
      previous,
      [{ ticketId: 't2' }, { ticketId: 't1' }, { text: 'Call Ann' }],
      ids(),
    );
    expect(items).toEqual([
      { id: 'new-1', ticketId: 't2', checked: false },
      { id: 'a', ticketId: 't1', checked: true },
      { id: 'b', text: 'Call Ann', checked: false },
    ]);
    expect(added).toEqual([items[0]]);
  });

  it('drops a deleted item, and takes the check an edit gives, as toggled', () => {
    const { items, toggled } = mergePlan(previous, [{ text: 'Call Ann', checked: true }], ids());
    expect(items).toEqual([{ id: 'b', text: 'Call Ann', checked: true }]);
    expect(toggled).toEqual(items);
  });

  it('starts every item unchecked with no plan before it', () => {
    const { items, added } = mergePlan(undefined, [{ ticketId: 't1' }], ids());
    expect(items).toEqual([{ id: 'new-1', ticketId: 't1', checked: false }]);
    expect(added).toHaveLength(1);
  });
});

describe('withChecked', () => {
  const items = [{ id: 'a', ticketId: 't1', checked: false }];

  it('checks an item and returns it', () => {
    const result = withChecked(items, 'a', true);
    expect(result.changed).toEqual({ id: 'a', ticketId: 't1', checked: true });
    expect(result.items[0].checked).toBe(true);
  });

  it('changes nothing when it already is so, or is not there', () => {
    expect(withChecked(items, 'a', false).changed).toBeNull();
    expect(withChecked(items, 'zz', true).changed).toBeNull();
  });
});

describe('touchAndGo', () => {
  const plan = [
    { id: 'a', ticketId: 'th1', checked: false },
    { id: 'b', ticketId: 'th2', checked: false },
    { id: 'c', text: 'Lunch', checked: false },
  ];

  it('TH-1 → TH-2 → TH-1 leaves TH-1 unchecked and TH-2 checked off', () => {
    const toTwo = touchAndGo(plan, { fromTicketId: 'th1', toTicketId: 'th2' });
    expect(toTwo.checkedOff).toEqual({ id: 'a', ticketId: 'th1', checked: true });
    const back = touchAndGo(toTwo.items, { fromTicketId: 'th2', toTicketId: 'th1' });
    expect(back.checkedOff).toEqual({ id: 'b', ticketId: 'th2', checked: true });
    expect(back.items.map((item) => [item.id, item.checked])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
    ]);
  });

  it('a first start checks nothing off; a ticket outside the plan changes nothing', () => {
    expect(touchAndGo(plan, { toTicketId: 'th1' })).toMatchObject({ changed: false, checkedOff: null });
    expect(touchAndGo(plan, { fromTicketId: 'th9', toTicketId: 'th8' }).changed).toBe(false);
  });

  it('switching away from a ticket outside the plan still unchecks the one started', () => {
    const checked = plan.map((item) => (item.id === 'b' ? { ...item, checked: true } : item));
    const result = touchAndGo(checked, { fromTicketId: 'th9', toTicketId: 'th2' });
    expect(result).toMatchObject({ changed: true, checkedOff: null });
    expect(result.items[1].checked).toBe(false);
  });
});
