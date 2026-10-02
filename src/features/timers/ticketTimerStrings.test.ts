import { describe, expect, it } from 'vitest';

import { timerLabel } from './ticketTimerStrings';

describe('timerLabel', () => {
  it('names a Redmine issue by its number, whatever its title', () => {
    expect(timerLabel('redmine', '1234', 'Fix the intake form')).toBe('#1234');
  });

  it('names a Huddle ticket by its title', () => {
    expect(timerLabel('huddle', '64f0c0ffee3fa2c', 'Fix login')).toBe('Fix login');
  });

  it("falls back to a Huddle ticket's short ref without a title", () => {
    expect(timerLabel('huddle', '64f0c0ffee3fa2c', null)).toBe('#3fa2c');
    expect(timerLabel('huddle', '64f0c0ffee3fa2c', '  ')).toBe('#3fa2c');
  });
});
