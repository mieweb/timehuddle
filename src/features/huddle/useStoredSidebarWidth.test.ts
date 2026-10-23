import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useStoredSidebarWidth } from './useStoredSidebarWidth';

afterEach(() => localStorage.clear());

describe('useStoredSidebarWidth', () => {
  it('is undefined until a width has been saved', () => {
    const { result } = renderHook(() => useStoredSidebarWidth());
    expect(result.current[0]).toBeUndefined();
  });

  it('keeps a saved width across remounts', () => {
    const first = renderHook(() => useStoredSidebarWidth());
    act(() => first.result.current[1](320));
    expect(first.result.current[0]).toBe(320);
    first.unmount();

    const { result } = renderHook(() => useStoredSidebarWidth());
    expect(result.current[0]).toBe(320);
  });

  it('ignores a stored value that is not a positive number', () => {
    localStorage.setItem('app:huddleSidebarWidth', 'wide');
    const { result } = renderHook(() => useStoredSidebarWidth());
    expect(result.current[0]).toBeUndefined();
  });
});
