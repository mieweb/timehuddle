import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useScopeChange } from './useScopeChange';

describe('useScopeChange', () => {
  it('reports the first load of a scope as a change, and a repeat as not', () => {
    const { result } = renderHook(() => useScopeChange());
    expect(result.current('team-a')).toBe(true);
    expect(result.current('team-a')).toBe(false);
  });

  it('reports a different scope as a change, and a return to the old one too', () => {
    const { result } = renderHook(() => useScopeChange());
    result.current('team-a');
    expect(result.current('team-b')).toBe(true);
    expect(result.current('team-a')).toBe(true);
  });

  it('treats no scope as a scope of its own', () => {
    const { result } = renderHook(() => useScopeChange());
    expect(result.current(null)).toBe(true);
    expect(result.current(null)).toBe(false);
    expect(result.current('team-a')).toBe(true);
  });

  it('keeps the same function across renders', () => {
    const { result, rerender } = renderHook(() => useScopeChange());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
