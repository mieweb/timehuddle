/**
 * The build details card shows the server's build once it answers, and says
 * so when it can't. Vite's define doesn't run under Vitest, so the app's own
 * section is the "no build details" case here.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuildDetails } from './BuildDetails';
import { type BuildInfo, isDevelopmentBuild, serverUrl } from './buildInfo';

const serverInfo: BuildInfo = {
  version: '1.2.0',
  builtAt: '2026-11-25T22:00:00.000Z',
  commit: '40a7f2580123456789abcdef0123456789abcdef',
  commitDate: '2026-11-25T21:00:00.000Z',
  branch: 'chore/mieweb-ui-main-sync',
  dirty: true,
  baseRef: 'origin/main',
  commitsAhead: 3,
  commits: [
    { sha: 'e120e76', date: '2026-11-25T20:00:00Z', subject: 'fix(huddle): a send refused' },
    { sha: '63a4c37', date: '2026-11-25T19:00:00Z', subject: 'fix(patches): safeProbe' },
  ],
};

function serverAnswers(response: Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BuildDetails', () => {
  it("shows the server's commit, branch and distance from the release", async () => {
    serverAnswers(Promise.resolve(new Response(JSON.stringify(serverInfo))));
    render(<BuildDetails />);

    expect(await screen.findByText('40a7f25801')).toBeTruthy();
    expect(screen.getByText('chore/mieweb-ui-main-sync')).toBeTruthy();
    expect(screen.getByText('Uncommitted changes')).toBeTruthy();
    expect(screen.getByText('3 commits not on main')).toBeTruthy();
    expect(screen.getByText('This build carries no build details.')).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toMatch(/\/api\/build-info$/);
  });

  it('shows no branch or commits for a build of main', async () => {
    const mainBuild = { ...serverInfo, branch: 'main', dirty: false, commitsAhead: 0, commits: [] };
    serverAnswers(Promise.resolve(new Response(JSON.stringify(mainBuild))));
    render(<BuildDetails />);

    expect(await screen.findByText('40a7f25801')).toBeTruthy();
    expect(screen.queryByText('Branch')).toBeNull();
    expect(screen.queryByText(/not on main/)).toBeNull();
  });

  it('says so when the server cannot be reached', async () => {
    serverAnswers(Promise.reject(new TypeError('Failed to fetch')));
    render(<BuildDetails />);

    expect(
      await screen.findByText('Could not reach the server, or it is too old to say.'),
    ).toBeTruthy();
    // Where it tried is the first thing to check when it can't be reached.
    expect(screen.getByText('URL')).toBeTruthy();
    expect(screen.getByText(serverUrl)).toBeTruthy();
  });

  it('treats a server without the endpoint as unreachable', async () => {
    serverAnswers(Promise.resolve(new Response('Not found', { status: 404 })));
    render(<BuildDetails />);

    expect(
      await screen.findByText('Could not reach the server, or it is too old to say.'),
    ).toBeTruthy();
  });
});

describe('isDevelopmentBuild', () => {
  it('is a build with commits main does not have', () => {
    expect(isDevelopmentBuild(serverInfo)).toBe(true);
  });

  it('is not a build of main, or one git could not place', () => {
    expect(isDevelopmentBuild({ ...serverInfo, commitsAhead: 0 })).toBe(false);
    expect(isDevelopmentBuild({ ...serverInfo, commitsAhead: null })).toBe(false);
  });
});
