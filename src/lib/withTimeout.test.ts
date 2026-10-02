import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from './withTimeout';

describe('withTimeout', () => {
  it('resolves with the value when the promise settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'timed out')).resolves.toBe('ok');
  });

  it('rejects with the original error when the promise rejects before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100, 'timed out')).rejects.toThrow(
      'boom',
    );
  });

  it('rejects with the timeout message when the promise never settles', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const result = withTimeout(never, 1000, 'timed out');
    const assertion = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });
});
