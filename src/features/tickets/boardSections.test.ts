import { describe, expect, it } from 'vitest';

import {
  arrangeFromIds,
  boardEntries,
  boardEntryId,
  canLandOn,
  PINNED_HEADING,
  REST_HEADING,
  splitPinned,
} from './boardSections';
import type { UnifiedTicket } from './sources';

const t = (key: string) => ({ key, title: key }) as UnifiedTicket;
const open = { pinned: false, rest: false };

describe('splitPinned', () => {
  it('lists the pinned in their pinned order and the rest as given', () => {
    const { pinned, rest } = splitPinned([t('a'), t('b'), t('c'), t('d')], ['c', 'a']);
    expect(pinned.map((x) => x.key)).toEqual(['c', 'a']);
    expect(rest.map((x) => x.key)).toEqual(['b', 'd']);
  });

  it('skips pinned keys that are not listed', () => {
    expect(splitPinned([t('a')], ['gone', 'a']).pinned.map((x) => x.key)).toEqual(['a']);
  });
});

describe('boardEntries', () => {
  it('puts each section under its heading', () => {
    expect(boardEntries([t('p')], [t('r')], open).map(boardEntryId)).toEqual([
      PINNED_HEADING,
      'p',
      REST_HEADING,
      'r',
    ]);
  });

  it('leaves a collapsed section’s tickets out', () => {
    expect(
      boardEntries([t('p')], [t('r')], { pinned: true, rest: false }).map(boardEntryId),
    ).toEqual([PINNED_HEADING, REST_HEADING, 'r']);
    expect(
      boardEntries([t('p')], [t('r')], { pinned: false, rest: true }).map(boardEntryId),
    ).toEqual([PINNED_HEADING, 'p', REST_HEADING]);
  });
});

describe('canLandOn', () => {
  it('keeps everything under the Pinned heading', () => {
    expect(canLandOn('a', PINNED_HEADING)).toBe(false);
    expect(canLandOn('a', REST_HEADING)).toBe(true);
  });
});

describe('arrangeFromIds', () => {
  it('pins a ticket dragged above the Rest heading, where it was dropped', () => {
    const ids = [PINNED_HEADING, 'p1', 'r1', 'p2', REST_HEADING, 'r2'];
    expect(
      arrangeFromIds(ids, ['p1', 'p2'], { pinned: ['p1', 'p2'], rest: ['r1', 'r2'] }, open),
    ).toEqual({
      pinned: ['p1', 'r1', 'p2'],
      rest: ['r2'],
    });
  });

  it('unpins a ticket dragged below the Rest heading', () => {
    const ids = [PINNED_HEADING, 'p2', REST_HEADING, 'p1', 'r1'];
    expect(arrangeFromIds(ids, ['p1', 'p2'], { pinned: ['p1', 'p2'], rest: ['r1'] }, open)).toEqual(
      {
        pinned: ['p2'],
        rest: ['p1', 'r1'],
      },
    );
  });

  it('adds a ticket dropped under a collapsed heading to the end', () => {
    const ids = [PINNED_HEADING, 'r1', REST_HEADING, 'r2'];
    expect(
      arrangeFromIds(
        ids,
        ['p1'],
        { pinned: ['p1'], rest: ['r1', 'r2'] },
        { pinned: true, rest: false },
      ),
    ).toEqual({
      pinned: ['p1', 'r1'],
      rest: ['r2'],
    });
  });

  it('puts a ticket dropped under a collapsed Rest heading at the top of the rest', () => {
    const ids = [PINNED_HEADING, 'p2', REST_HEADING, 'p1'];
    expect(
      arrangeFromIds(
        ids,
        ['p1', 'p2'],
        { pinned: ['p1', 'p2'], rest: ['r1'] },
        { pinned: false, rest: true },
      ),
    ).toEqual({ pinned: ['p2'], rest: ['p1', 'r1'] });
  });

  it('keeps the pins a filter hides, last', () => {
    const ids = [PINNED_HEADING, 'p1', REST_HEADING, 'r1'];
    expect(arrangeFromIds(ids, ['hidden', 'p1'], { pinned: ['p1'], rest: ['r1'] }, open)).toEqual({
      pinned: ['p1', 'hidden'],
      rest: ['r1'],
    });
  });
});
