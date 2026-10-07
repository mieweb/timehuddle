import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIsCurrent } from './useIsCurrent';

describe('useIsCurrent', () => {
  it('answers against the latest rendered value, for a function captured earlier', () => {
    const { result, rerender } = renderHook(({ team }) => useIsCurrent(team), {
      initialProps: { team: 'team-a' },
    });
    const captured = result.current;
    expect(captured('team-a')).toBe(true);

    rerender({ team: 'team-b' });
    expect(captured('team-a')).toBe(false);
    expect(captured('team-b')).toBe(true);
  });

  it('keeps the same function across renders', () => {
    const { result, rerender } = renderHook(({ team }) => useIsCurrent(team), {
      initialProps: { team: 'team-a' as string | null },
    });
    const first = result.current;
    rerender({ team: null });
    expect(result.current).toBe(first);
    expect(first(null)).toBe(true);
  });
});
