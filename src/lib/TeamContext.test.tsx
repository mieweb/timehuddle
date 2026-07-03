import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockUser: {
  id: string;
  username: string | null;
  [key: string]: unknown;
} | null = null;

vi.mock('./useSession', () => ({
  useSession: () => ({
    user: mockUser,
    loading: false,
    needsUsernameClaim: false,
    refetch: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const listOrganizationsMock = vi.fn().mockResolvedValue([]);

vi.mock('./api', () => ({
  teamApi: {
    getTeams: vi.fn().mockResolvedValue({ teams: [], pendingRequests: [] }),
    ensurePersonal: vi.fn().mockResolvedValue(undefined),
  },
  orgApi: {
    listOrganizations: (...args: unknown[]) => listOrganizationsMock(...args),
  },
  enterpriseApi: {
    list: vi.fn().mockResolvedValue([]),
  },
  clockApi: {
    getActive: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('./ddp', () => ({
  getDdpClient: () => ({
    docs: () => [],
    onCollectionChange: () => () => {},
    subscribe: (_name: string, _params: unknown[], cb: () => void) => {
      cb();
      return () => {};
    },
  }),
  ddpDocToClockEvent: vi.fn(),
  ddpDocToTeam: vi.fn(),
}));

import { TeamProvider, useTeam } from './TeamContext';

// ── Test helper ───────────────────────────────────────────────────────────────

/** Renders a consumer that displays the org list from TeamContext. */
function OrgDisplay() {
  const { organizations } = useTeam();
  return (
    <div data-testid="orgs">
      {organizations.length === 0
        ? 'no-orgs'
        : organizations.map((o) => o.name).join(',')}
    </div>
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TeamContext organization refetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser = null;
    listOrganizationsMock.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('re-fetches organizations when username changes (username claim)', async () => {
    const defaultOrg = {
      id: 'org-1',
      enterpriseId: null,
      name: 'Default Organization',
      slug: 'default',
      allowAutoJoin: true,
      role: 'member' as const,
    };

    // First call returns empty (race condition with auto-join),
    // subsequent calls return the org.
    listOrganizationsMock
      .mockResolvedValueOnce([]) // initial fetch when userId appears
      .mockResolvedValueOnce([]) // retry fetch (still empty during username claim)
      .mockResolvedValue([defaultOrg]); // after username claim

    // Start with a user who has no username yet (needs claim)
    mockUser = { id: 'user-1', username: null };

    const { rerender } = render(
      <TeamProvider>
        <OrgDisplay />
      </TeamProvider>,
    );

    // Let the initial org fetch complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByTestId('orgs').textContent).toBe('no-orgs');

    // Simulate username claim: user.username changes from null to 'jiadoe'
    mockUser = { id: 'user-1', username: 'jiadoe' };
    rerender(
      <TeamProvider>
        <OrgDisplay />
      </TeamProvider>,
    );

    // Let the refetch triggered by username change complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByTestId('orgs').textContent).toBe('Default Organization');
  });

  it('retries org fetch once when initial fetch returns empty', async () => {
    const defaultOrg = {
      id: 'org-1',
      enterpriseId: null,
      name: 'Default Organization',
      slug: 'default',
      allowAutoJoin: true,
      role: 'member' as const,
    };

    // Simulate auto-join completing between initial fetches and the delayed retry.
    // Use a flag to switch from empty → populated after the initial burst.
    let autoJoinComplete = false;
    listOrganizationsMock.mockImplementation(() =>
      Promise.resolve(autoJoinComplete ? [defaultOrg] : []),
    );

    mockUser = { id: 'user-1', username: 'jiadoe' };

    render(
      <TeamProvider>
        <OrgDisplay />
      </TeamProvider>,
    );

    // Let initial fetches (from multiple effects) settle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByTestId('orgs').textContent).toBe('no-orgs');

    // Simulate auto-join completing on the server
    autoJoinComplete = true;

    // Retry timer fires at 1500ms — by now auto-join has completed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(screen.getByTestId('orgs').textContent).toBe('Default Organization');
  });
});
