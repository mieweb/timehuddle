import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useStoredSidebarWidth } from './useStoredSidebarWidth';

afterEach(() => localStorage.clear());

describe('useStoredSidebarWidth', () => {
  it('is undefined until a width has been saved', () => {
    const { result } = renderHook(() => useStoredSidebarWidth('alice'));
    expect(result.current[0]).toBeUndefined();
  });

  it('keeps a saved width across remounts', () => {
    const first = renderHook(() => useStoredSidebarWidth('alice'));
    act(() => first.result.current[1](320));
    expect(first.result.current[0]).toBe(320);
    first.unmount();

    const { result } = renderHook(() => useStoredSidebarWidth('alice'));
    expect(result.current[0]).toBe(320);
  });

  it('keeps each user’s width separate', () => {
    const alice = renderHook(() => useStoredSidebarWidth('alice'));
    act(() => alice.result.current[1](320));
    const bob = renderHook(() => useStoredSidebarWidth('bob'));
    expect(bob.result.current[0]).toBeUndefined();
    act(() => bob.result.current[1](480));
    expect(alice.result.current[0]).toBe(320);
  });

  it('loads the new user’s width when the account switches', () => {
    localStorage.setItem('app:huddleSidebarWidth:bob', '400');
    const { result, rerender } = renderHook(({ id }) => useStoredSidebarWidth(id), {
      initialProps: { id: 'alice' },
    });
    expect(result.current[0]).toBeUndefined();
    rerender({ id: 'bob' });
    expect(result.current[0]).toBe(400);
  });

  it('ignores a stored value that is not a positive number', () => {
    localStorage.setItem('app:huddleSidebarWidth:alice', 'wide');
    const { result } = renderHook(() => useStoredSidebarWidth('alice'));
    expect(result.current[0]).toBeUndefined();
  });
});
