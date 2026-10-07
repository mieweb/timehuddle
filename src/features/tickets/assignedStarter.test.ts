import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assignedToMe, isApproximate, starterText, useAssignedNotice } from './assignedStarter';
import type { UnifiedTicket } from './sources';

const CAPS = { edit: true, delete: false, changeStatus: true, openExternal: true };

function ticket(
  sourceId: 'huddle' | 'redmine',
  id: string,
  assigneeId: string | null,
  isClosed = false,
): UnifiedTicket {
  return {
    key: `${sourceId}:${id}`,
    sourceId,
    id,
    ref: `#${id}`,
    title: `Ticket ${id}`,
    container: null,
    status: { native: isClosed ? 'Closed' : 'New', isClosed },
    priority: null,
    assignees: assigneeId ? [{ id: assigneeId, name: assigneeId }] : [],
    createdBy: null,
    createdAt: null,
    updatedAt: null,
    externalUrl: null,
    externalRef: null,
    sharedWithTimeharbor: false,
    linked: null,
    capabilities: CAPS,
  };
}

const ME_KEYS = ['huddle:u1', 'redmine:7'];

describe('assignedToMe', () => {
  it('keeps the open Redmine issues assigned to the user, in the order given', () => {
    const tickets = [
      ticket('redmine', '30', '7'),
      ticket('huddle', 'a', 'u1'),
      ticket('redmine', '10', '7'),
      ticket('redmine', '20', '8'),
      ticket('redmine', '40', '7', true),
      ticket('redmine', '50', null),
    ];
    expect(assignedToMe(tickets, ME_KEYS).map((t) => t.key)).toEqual(['redmine:30', 'redmine:10']);
  });

  it('finds nothing without a Redmine identity', () => {
    expect(assignedToMe([ticket('redmine', '30', '7')], ['huddle:u1'])).toEqual([]);
  });
});

describe('the count in the notice', () => {
  it('is exact below the server cap and a lower bound at it', () => {
    const assigned = (n: number) =>
      Array.from({ length: n }, (_, i) => ticket('redmine', String(i), '7'));
    expect(isApproximate(assigned(99))).toBe(false);
    expect(isApproximate(assigned(100))).toBe(true);
  });

  it('reads in the singular and the plural', () => {
    expect(starterText.moreAssigned(1, false)).toBe(
      '1 more issue assigned to you is in All Sources.',
    );
    expect(starterText.moreAssigned(90, true)).toBe(
      '90+ more issues assigned to you are in All Sources.',
    );
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
