import { describe, expect, it } from 'vitest';

import { exactIdFirst } from './exactIdFirst';

const rows = [{ ids: ['PM0-120', 'TH-56'] }, { ids: ['PM0-15'] }, { ids: ['PM0-1'] }, { ids: [] }];
const idsOf = (row: { ids: string[] }) => row.ids;

describe('exactIdFirst', () => {
  it('moves the row whose ID is exactly what was typed to the top, keeping the rest in order', () => {
    expect(exactIdFirst(rows, ' pm0-1 ', idsOf).map((row) => row.ids[0])).toEqual([
      'PM0-1',
      'PM0-120',
      'PM0-15',
      undefined,
    ]);
  });

  it('matches any of the IDs a row is shown with', () => {
    expect(exactIdFirst(rows, 'TH-56', idsOf)[0]).toBe(rows[0]);
  });

  it('leaves the order alone with no exact match, or nothing typed', () => {
    expect(exactIdFirst(rows, 'PM0', idsOf)).toEqual(rows);
    expect(exactIdFirst(rows, '', idsOf)).toBe(rows);
  });
});
