import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ASSIGNED_PAGES_PER_FILL,
  collectAssignedOffBoard,
  starterText,
  useAssignedNotice,
} from './assignedStarter';

describe('the notice', () => {
  it('reads in the singular and the plural', () => {
    expect(starterText.moreAssigned(1)).toBe('1 more issue assigned to you in Redmine.');
    expect(starterText.moreAssigned(90)).toBe('90 more issues assigned to you in Redmine.');
    expect(starterText.addMoreLabel(1)).toBe('Add 1 more issue assigned to you to My Board');
  });
});

describe('useAssignedNotice', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('stays shown across a reload until dismissed, then stays dismissed', () => {
    const first = renderHook(() => useAssignedNotice('u1'));
    expect(first.result.current.open).toBe(false);
    act(() => first.result.current.show());
    expect(first.result.current.open).toBe(true);
    first.unmount();

    const second = renderHook(() => useAssignedNotice('u1'));
    expect(second.result.current.open).toBe(true);
    act(() => second.result.current.dismiss());
    second.unmount();

    expect(renderHook(() => useAssignedNotice('u1')).result.current.open).toBe(false);
  });

  it('is per user', () => {
    const { result, rerender } = renderHook(({ userId }) => useAssignedNotice(userId), {
      initialProps: { userId: 'u1' as string | null },
    });
    act(() => result.current.show());
    rerender({ userId: 'u2' });
    expect(result.current.open).toBe(false);
    rerender({ userId: 'u1' });
    expect(result.current.open).toBe(true);
  });
});

describe('collectAssignedOffBoard (#736)', () => {
  /** A Redmine with `total` assigned issues, ids from 1, served 100 a page. */
  const redmine = (total: number) => {
    const offsets: number[] = [];
    const fetchPage = async (offset: number) => {
      offsets.push(offset);
      const ids = Array.from(
        { length: Math.max(0, Math.min(100, total - offset)) },
        (_, i) => offset + i + 1,
      );
      const end = offset + ids.length;
      return { issueIds: ids, nextOffset: end < total ? end : null };
    };
    return { offsets, fetchPage };
  };

  it('stops at the first page that holds more than a batch off the board', async () => {
    const { offsets, fetchPage } = redmine(250);
    const result = await collectAssignedOffBoard(fetchPage, () => true);
    expect(offsets).toEqual([0]);
    expect(result.offBoard).toHaveLength(100);
    expect(result.nextOffset).toBe(100);
  });

  it('reads on past the first hundred when those are all on the board', async () => {
    const { offsets, fetchPage } = redmine(250);
    const result = await collectAssignedOffBoard(fetchPage, (id) => id > 195);
    expect(offsets).toEqual([0, 100, 200]);
    expect(result.offBoard).toEqual(Array.from({ length: 55 }, (_, i) => 196 + i));
    // The whole list was read, so what's left is an exact count.
    expect(result.nextOffset).toBeNull();
  });

  it('says where to carry on when it stops at its page limit', async () => {
    const { offsets, fetchPage } = redmine(5000);
    const result = await collectAssignedOffBoard(fetchPage, () => false);
    expect(offsets).toHaveLength(ASSIGNED_PAGES_PER_FILL);
    expect(result.offBoard).toEqual([]);
    expect(result.nextOffset).toBe(ASSIGNED_PAGES_PER_FILL * 100);
  });

  it('takes a page with no nextOffset as the whole list', async () => {
    const fetchPage = vi.fn(async () => ({ issueIds: [1, 2, 3] }));
    const result = await collectAssignedOffBoard(fetchPage, () => true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ offBoard: [1, 2, 3], nextOffset: null });
  });
});
