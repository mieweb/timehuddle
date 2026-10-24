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

/** A TimeHuddle ticket carrying Redmine issue `issueId`, assigned in Redmine to `assigneeId`. */
function carrier(id: string, assigneeId: string | null, isClosed = false): UnifiedTicket {
  const status = { native: isClosed ? 'Closed' : 'New', isClosed };
  return {
    ...ticket('huddle', id, null, isClosed),
    linked: {
      sourceId: 'redmine',
      id: `9${id}`,
      ref: `PM-9${id}`,
      status,
      assignee: assigneeId ? { id: assigneeId, name: assigneeId } : null,
    },
  };
}

describe('assignedToMe', () => {
  it("keeps tickets carrying the user's open Redmine issues, in the order given (#736)", () => {
    const tickets = [
      carrier('a', '7'),
      ticket('huddle', 'plain', 'u1'),
      carrier('b', '7'),
      carrier('c', '8'),
      carrier('d', '7', true),
      carrier('e', null),
    ];
    expect(assignedToMe(tickets, ME_KEYS).map((t) => t.key)).toEqual(['huddle:a', 'huddle:b']);
  });

  it('goes by the Redmine assignee, never the ticket\u2019s own', () => {
    // Assigned in TimeHuddle to the user, but the issue is nobody's in Redmine.
    const linked: UnifiedTicket = { ...carrier('a', null), assignees: [{ id: 'u1', name: 'u1' }] };
    expect(assignedToMe([linked], ME_KEYS)).toEqual([]);
  });

  it('finds nothing without a Redmine identity', () => {
    expect(assignedToMe([carrier('a', '7')], ['huddle:u1'])).toEqual([]);
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
