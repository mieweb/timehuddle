import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const clearCachedDataMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./ddp', () => ({
  DdpTransportError: class DdpTransportError extends Error {},
  getDdpClient: () => ({
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
    onReconnect: () => () => {},
  }),
}));

vi.mock('./api', () => ({
  authApi: { signOut: vi.fn() },
  orgApi: { listOrganizations: vi.fn().mockResolvedValue([]) },
}));

vi.mock('./queryClient', () => ({
  clearCachedData: () => clearCachedDataMock(),
}));

import { DdpTransportError } from './ddp';
import { SessionProvider, useSession } from './useSession';

function meteorUser(id: string) {
  return {
    id,
    email: `${id}@test.local`,
    name: id,
    username: id,
    image: null,
    emailVerified: true,
    createdAt: null,
    releaseNotesSeenVersion: null,
  };
}

function CurrentUser() {
  const { user } = useSession();
  return <div data-testid="user">{user?.id ?? 'none'}</div>;
}

describe('SessionProvider last-user cache', () => {
  beforeEach(() => {
    localStorage.clear();
    getCurrentUserMock.mockReset();
    clearCachedDataMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the last known user before the session check resolves', async () => {
    localStorage.setItem('meteor_resume_token', 'token');
    localStorage.setItem('app:lastUser', JSON.stringify({ id: 'userA' }));
    let resolve: (u: ReturnType<typeof meteorUser>) => void = () => {};
    getCurrentUserMock.mockReturnValue(new Promise((r) => (resolve = r)));

    render(
      <SessionProvider>
        <CurrentUser />
      </SessionProvider>,
    );

    expect(screen.getByTestId('user').textContent).toBe('userA');

    await act(async () => resolve(meteorUser('userA')));
    expect(screen.getByTestId('user').textContent).toBe('userA');
    expect(clearCachedDataMock).not.toHaveBeenCalled();
  });

  it('clears cached data when a different user signs in on the same device', async () => {
    localStorage.setItem('meteor_resume_token', 'token');
    localStorage.setItem('app:lastUser', JSON.stringify({ id: 'userA' }));
    getCurrentUserMock.mockResolvedValue(meteorUser('userB'));

    render(
      <SessionProvider>
        <CurrentUser />
      </SessionProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId('user').textContent).toBe('userB');
    expect(clearCachedDataMock).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('app:lastUser') ?? '{}').id).toBe('userB');
  });

  it('keeps the signed-in user when the server cannot be reached', async () => {
    localStorage.setItem('meteor_resume_token', 'token');
    localStorage.setItem('app:lastUser', JSON.stringify({ id: 'userA' }));
    getCurrentUserMock.mockRejectedValue(new DdpTransportError('DDP connection lost'));

    render(
      <SessionProvider>
        <CurrentUser />
      </SessionProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId('user').textContent).toBe('userA');
    expect(clearCachedDataMock).not.toHaveBeenCalled();
  });

  it('ignores the cached user and clears cached data when there is no session token', async () => {
    localStorage.setItem('app:lastUser', JSON.stringify({ id: 'userA' }));
    getCurrentUserMock.mockResolvedValue(null);

    render(
      <SessionProvider>
        <CurrentUser />
      </SessionProvider>,
    );

    expect(screen.getByTestId('user').textContent).toBe('none');
    await act(async () => {});
    expect(clearCachedDataMock).toHaveBeenCalled();
    expect(localStorage.getItem('app:lastUser')).toBeNull();
  });
});
