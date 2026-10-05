import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
const getOpenShiftsMock = vi.fn().mockResolvedValue([]);

// The live clockevents/clockbreaks docs and their change listeners, driven by the tests.
let ddpClockDocs: Record<string, unknown>[] = [];
let ddpBreakDocs: Record<string, unknown>[] = [];
const ddpListeners = new Map<string, () => void>();

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
    getOpenShifts: (...args: unknown[]) => getOpenShiftsMock(...args),
  },
}));

vi.mock('./ddp', () => ({
  getDdpClient: () => ({
    docs: (collection: string) =>
      collection === 'clockevents'
        ? ddpClockDocs
        : collection === 'clockbreaks'
          ? ddpBreakDocs
          : [],
    onCollectionChange: (collection: string, cb: () => void) => {
      ddpListeners.set(collection, cb);
      return () => {};
    },
    onDisconnect: () => () => {},
    subscribe: (_name: string, _params: unknown[], cb: () => void) => {
      cb();
      return () => {};
    },
  }),
  ddpDocToClockEvent: (doc: unknown) => doc,
  ddpDocToTeam: vi.fn(),
}));

import { TeamProvider, useTeam } from './TeamContext';

// ── Test helper ───────────────────────────────────────────────────────────────

/** Renders a consumer that displays the org list from TeamContext. */
function OrgDisplay() {
  const { organizations } = useTeam();
  return (
    <div data-testid="orgs">
      {organizations.length === 0 ? 'no-orgs' : organizations.map((o) => o.name).join(',')}
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

// ── Open shifts ───────────────────────────────────────────────────────────────

function OpenShiftsDisplay() {
  const { openShifts } = useTeam();
  return (
    <div data-testid="open-shifts">
      {Object.entries(openShifts)
        .map(([teamId, shift]) => `${teamId}=${shift.id}`)
        .sort()
        .join(',') || 'none'}
    </div>
  );
}

describe('TeamContext open shifts', () => {
  beforeEach(() => {
    mockUser = { id: 'user-1', username: 'jiadoe' };
    localStorage.setItem('meteor_resume_token', 'token');
    ddpClockDocs = [];
    ddpBreakDocs = [];
    ddpListeners.clear();
    getOpenShiftsMock.mockReset().mockResolvedValue([{ id: 'evt-a', teamId: 'team-a' }]);
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem('meteor_resume_token');
  });

  it('keeps every open shift keyed by team, and refetches when the live set changes', async () => {
    render(
      <TeamProvider>
        <OpenShiftsDisplay />
      </TeamProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('open-shifts').textContent).toBe('team-a=evt-a'));

    // Another tab clocks in to team B: the live doc set changes.
    getOpenShiftsMock.mockResolvedValue([
      { id: 'evt-a', teamId: 'team-a' },
      { id: 'evt-b', teamId: 'team-b' },
    ]);
    ddpClockDocs = [
      { id: 'evt-a', userId: 'user-1', teamId: 'team-a', endTime: null },
      { id: 'evt-b', userId: 'user-1', teamId: 'team-b', endTime: null },
    ];
    act(() => ddpListeners.get('clockevents')?.());

    await waitFor(() =>
      expect(screen.getByTestId('open-shifts').textContent).toBe('team-a=evt-a,team-b=evt-b'),
    );
  });

  it("ignores live changes to other people's shifts", async () => {
    render(
      <TeamProvider>
        <OpenShiftsDisplay />
      </TeamProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('open-shifts').textContent).toBe('team-a=evt-a'));
    const calls = getOpenShiftsMock.mock.calls.length;

    ddpClockDocs = [{ id: 'evt-x', userId: 'someone-else', teamId: 'team-a', endTime: null }];
    act(() => ddpListeners.get('clockevents')?.());

    await act(async () => {
      await Promise.resolve();
    });
    expect(getOpenShiftsMock.mock.calls.length).toBe(calls);
  });

  it('refetches when a break starts or ends in another tab', async () => {
    ddpClockDocs = [{ id: 'evt-a', userId: 'user-1', teamId: 'team-a', endTime: null }];
    render(
      <TeamProvider>
        <OpenShiftsDisplay />
      </TeamProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('open-shifts').textContent).toBe('team-a=evt-a'));
    const calls = getOpenShiftsMock.mock.calls.length;

    // Paused elsewhere: only clockbreaks changes.
    ddpBreakDocs = [{ _id: 'brk-1', clockEventId: 'evt-a', startTime: 1, endTime: null }];
    act(() => ddpListeners.get('clockbreaks')?.());
    await waitFor(() => expect(getOpenShiftsMock.mock.calls.length).toBe(calls + 1));

    // Resumed elsewhere: the same break closes.
    ddpBreakDocs = [{ _id: 'brk-1', clockEventId: 'evt-a', startTime: 1, endTime: 2 }];
    act(() => ddpListeners.get('clockbreaks')?.());
    await waitFor(() => expect(getOpenShiftsMock.mock.calls.length).toBe(calls + 2));
  });
});
