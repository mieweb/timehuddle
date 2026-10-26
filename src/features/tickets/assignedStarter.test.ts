import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { starterText, useAssignedNotice } from './assignedStarter';

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
