import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedmineStatus } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useMeAssigneeKeys } from './useMeAssigneeKeys';

vi.mock('../../lib/useSession', () => ({
  useSession: vi.fn(),
}));

const mockUseSession = vi.mocked(useSession);

function signedInAs(userId: string | null) {
  mockUseSession.mockReturnValue({
    user: userId ? { id: userId } : null,
  } as unknown as ReturnType<typeof useSession>);
}

const connected = (redmineUserId: number): RedmineStatus => ({
  connected: true,
  redmineUserId,
  baseUrl: 'https://redmine.example.test',
});

describe('useMeAssigneeKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedInAs('u1');
  });

  it('is Huddle-only while the Redmine status is unknown', () => {
    const { result } = renderHook(() => useMeAssigneeKeys(null));

    expect(result.current).toEqual(['huddle:u1']);
  });

  it('is Huddle-only when no Redmine account is linked', () => {
    const { result } = renderHook(() => useMeAssigneeKeys({ connected: false }));

    expect(result.current).toEqual(['huddle:u1']);
  });

  it('spans both namespaces once an account is linked', () => {
    const { result } = renderHook(() => useMeAssigneeKeys(connected(8)));

    expect(result.current).toEqual(['huddle:u1', 'redmine:8']);
  });

  it('keeps the namespaces separate, so ids cannot collide across sources', () => {
    // Huddle user "8" and Redmine account 8 are unrelated; only the namespaced
    // form distinguishes them.
    signedInAs('8');

    const { result } = renderHook(() => useMeAssigneeKeys(connected(8)));

    expect(result.current).toEqual(['huddle:8', 'redmine:8']);
  });

  it('ignores a connected account with no Redmine user id', () => {
    const { result } = renderHook(() =>
      useMeAssigneeKeys({ connected: true, baseUrl: 'https://redmine.example.test' }),
    );

    expect(result.current).toEqual(['huddle:u1']);
  });

  it('returns nothing when no one is signed in', () => {
    signedInAs(null);

    const { result } = renderHook(() => useMeAssigneeKeys(connected(8)));

    expect(result.current).toEqual([]);
  });

  it('keeps a stable array identity across re-renders', () => {
    // It feeds a useMemo dependency in useTicketTableView, so a fresh array
    // every render would re-filter the whole ticket list each time.
    const status = connected(8);
    const { result, rerender } = renderHook(() => useMeAssigneeKeys(status));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
