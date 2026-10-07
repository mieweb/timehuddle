import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLatestRequest } from './useLatestRequest';

describe('useLatestRequest', () => {
  it('reports a load as current until another begins', () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = result.current();
    expect(first()).toBe(true);
    const second = result.current();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('keeps the same function across renders, and the count with it', () => {
    const { result, rerender } = renderHook(() => useLatestRequest());
    const begin = result.current;
    const first = begin();
    rerender();
    expect(result.current).toBe(begin);
    result.current();
    expect(first()).toBe(false);
  });
});
