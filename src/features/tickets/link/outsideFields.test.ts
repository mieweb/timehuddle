import { describe, expect, it } from 'vitest';

import { outsideFieldRows } from './outsideFields';

const EMPTY = { type: null, labels: [], milestone: null, extra: [] };

describe('outsideFieldRows', () => {
  it('lists nothing for an issue with no type, labels, milestone or custom fields', () => {
    expect(outsideFieldRows(EMPTY)).toEqual([]);
  });

  it('shows the tracker once, as the type, and the other labels as badges', () => {
    expect(
      outsideFieldRows({
        ...EMPTY,
        type: { id: '1', name: 'Bug' },
        labels: [
          { name: 'Bug', group: 'tracker' },
          { name: 'Billing', group: 'category' },
        ],
      }),
    ).toEqual([
      { label: 'Type', values: ['Bug'] },
      { label: 'Labels', values: ['Billing'], badges: true },
    ]);
  });

  it("keeps a label that shares the type's name but isn't the tracker", () => {
    expect(
      outsideFieldRows({
        ...EMPTY,
        type: { id: '1', name: 'Bug' },
        labels: [
          { name: 'Bug', group: 'tracker' },
          { name: 'Bug', group: 'category' },
        ],
      }),
    ).toEqual([
      { label: 'Type', values: ['Bug'] },
      { label: 'Labels', values: ['Bug'], badges: true },
    ]);
  });

  it('shows the milestone by name', () => {
    const [row] = outsideFieldRows({
      ...EMPTY,
      milestone: { id: '7', name: 'Sprint 12', due: '2026-11-03' },
    });
    expect(row).toEqual({ label: 'Milestone', values: ['Sprint 12'] });
  });

  it('lists custom fields under their own names and leaves out empty ones', () => {
    expect(
      outsideFieldRows({
        ...EMPTY,
        extra: [
          { label: 'Billable', value: 'Yes' },
          { label: 'Customer', value: '  ' },
        ],
      }),
    ).toEqual([{ label: 'Billable', values: ['Yes'] }]);
  });
});
