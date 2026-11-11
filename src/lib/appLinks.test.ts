import { describe, expect, it } from 'vitest';

import { openInAppUrl } from './appLinks';

describe('openInAppUrl', () => {
  it('opens an in-app route, query and all', () => {
    expect(openInAppUrl('/app/huddle?team=abc')).toBe('timehuddle://open/app/huddle?team=abc');
    expect(openInAppUrl('/app')).toBe('timehuddle://open/app');
    expect(openInAppUrl('/app?team=abc')).toBe('timehuddle://open/app?team=abc');
  });

  it('falls back to the app home for anything the app would refuse', () => {
    expect(openInAppUrl('/release-notes')).toBe('timehuddle://open/app');
    expect(openInAppUrl('//example.com/app')).toBe('timehuddle://open/app');
    expect(openInAppUrl('/apples')).toBe('timehuddle://open/app');
  });
});
