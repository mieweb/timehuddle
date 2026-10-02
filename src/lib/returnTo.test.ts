import { beforeEach, describe, expect, it } from 'vitest';

import { forgetReturnTo, rememberReturnTo, restoreReturnTo } from './returnTo';

describe('returnTo', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('brings the browser back to a remembered app link, once', () => {
    window.history.replaceState(null, '', '/app/tickets/abc?team=t1');
    rememberReturnTo();
    window.history.replaceState(null, '', '/');

    expect(restoreReturnTo()).toBe(true);
    expect(window.location.pathname + window.location.search).toBe('/app/tickets/abc?team=t1');

    window.history.replaceState(null, '', '/');
    expect(restoreReturnTo()).toBe(false);
  });

  it('restores after an OAuth round trip lands on the dashboard', () => {
    window.history.replaceState(null, '', '/app/tickets/abc');
    rememberReturnTo();
    window.history.replaceState(null, '', '/app/dashboard');
    expect(restoreReturnTo()).toBe(true);
    expect(window.location.pathname).toBe('/app/tickets/abc');
  });

  it('never overrides a page the user opened since, and drops the stale link', () => {
    window.history.replaceState(null, '', '/app/dashboard?team=t1');
    rememberReturnTo();
    window.history.replaceState(null, '', '/app/huddle');
    expect(restoreReturnTo()).toBe(false);
    expect(window.location.pathname).toBe('/app/huddle');

    window.history.replaceState(null, '', '/');
    expect(restoreReturnTo()).toBe(false);
  });

  it('lets an invite or join landing keep its own query', () => {
    window.history.replaceState(null, '', '/app/tickets/abc');
    rememberReturnTo();
    window.history.replaceState(null, '', '/app/dashboard?join=CODE');
    expect(restoreReturnTo()).toBe(false);
    expect(window.location.search).toBe('?join=CODE');
  });

  it('ignores pages outside the app', () => {
    window.history.replaceState(null, '', '/release-notes');
    rememberReturnTo();
    expect(restoreReturnTo()).toBe(false);
  });

  it('forgets the link on an explicit sign-out', () => {
    window.history.replaceState(null, '', '/app/teams/t1');
    rememberReturnTo();
    forgetReturnTo();
    expect(restoreReturnTo()).toBe(false);
  });
});
