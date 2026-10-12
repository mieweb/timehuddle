import { beforeEach, describe, expect, it } from 'vitest';

import { redirectSignedInRootToDashboard } from './rootRedirect';

describe('redirectSignedInRootToDashboard', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('moves a signed-in visitor at / to the dashboard', () => {
    localStorage.setItem('meteor_resume_token', 'tok');

    expect(redirectSignedInRootToDashboard()).toBe(true);
    expect(window.location.pathname).toBe('/app/dashboard');
  });

  it('keeps the query string, which can carry an invite or join link', () => {
    localStorage.setItem('meteor_resume_token', 'tok');
    window.history.replaceState(null, '', '/?join=abc');

    expect(redirectSignedInRootToDashboard()).toBe(true);
    expect(window.location.pathname + window.location.search).toBe('/app/dashboard?join=abc');
  });

  it('leaves a signed-out visitor on the landing page', () => {
    expect(redirectSignedInRootToDashboard()).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('does not touch other routes', () => {
    localStorage.setItem('meteor_resume_token', 'tok');
    window.history.replaceState(null, '', '/release-notes');

    expect(redirectSignedInRootToDashboard()).toBe(false);
    expect(window.location.pathname).toBe('/release-notes');
  });

  it('replaces the history entry so Back does not return to /', () => {
    localStorage.setItem('meteor_resume_token', 'tok');
    const before = window.history.length;

    redirectSignedInRootToDashboard();

    expect(window.history.length).toBe(before);
  });
});
