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
const getTeamsMock = vi.fn().mockResolvedValue({ teams: [], pendingRequests: [] });

vi.mock('./api', () => ({
  teamApi: {
    getTeams: (...args: unknown[]) => getTeamsMock(...args),
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
    onDisconnect: () => () => {},
    subscribe: (_name: string, _params: unknown[], cb: () => void) => {
      cb();
      return () => {};
    },
  }),
  ddpDocToClockEvent: vi.fn(),
  ddpDocToTeam: vi.fn(),
}));

import { RouterProvider } from '../ui/router';
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

// ── URL scope ─────────────────────────────────────────────────────────────────

function team(id: string, orgId: string) {
  return {
    id,
    orgId,
    parentTeamId: null,
    name: id,
    description: null,
    members: ['user-1'],
    admins: [],
    code: id,
    isPersonal: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
  };
}

const orgs = ['org-a', 'org-b'].map((id) => ({
  id,
  enterpriseId: null,
  name: id,
  slug: id,
  allowAutoJoin: false,
  role: 'member' as const,
}));

let ctx: ReturnType<typeof useTeam>;
function ScopeProbe() {
  ctx = useTeam();
  return (
    <div data-testid="scope">
      {ctx.selectedTeamId}|{ctx.selectedOrgId}|{ctx.teamAccess}
    </div>
  );
}

function renderAt(url: string) {
  window.history.replaceState(null, '', url);
  render(
    <RouterProvider>
      <TeamProvider>
        <ScopeProbe />
      </TeamProvider>
    </RouterProvider>,
  );
}

const scope = () => screen.getByTestId('scope').textContent;

describe('TeamContext URL scope', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser = { id: 'user-1', username: 'jiadoe' };
    localStorage.setItem('app:selectedTeamId:user-1', 't1');
    localStorage.setItem('app:selectedOrgId:user-1', 'org-a');
    listOrganizationsMock.mockReset().mockResolvedValue(orgs);
    getTeamsMock.mockReset().mockResolvedValue({
      teams: [team('t1', 'org-a'), team('t2', 'org-a'), team('t3', 'org-b')],
      pendingRequests: [],
    });
  });

  afterEach(cleanup);

  it('stamps the stored team onto a URL without one', async () => {
    renderAt('/app/dashboard');
    await waitFor(() => expect(window.location.search).toBe('?team=t1'));
    expect(scope()).toBe('t1|org-a|ok');
  });

  it('lets ?team= override the stored team and remembers it', async () => {
    renderAt('/app/dashboard?team=t2');
    await waitFor(() => expect(scope()).toBe('t2|org-a|ok'));
    expect(localStorage.getItem('app:selectedTeamId:user-1')).toBe('t2');
  });

  it('normalises the legacy ?teamId= alias to ?team=', async () => {
    renderAt('/app/dashboard?tab=team&teamId=t2');
    await waitFor(() => expect(window.location.search).toBe('?tab=team&team=t2'));
  });

  it('switches org when the URL team lives in another org', async () => {
    renderAt('/app/huddle?team=t3');
    await waitFor(() => expect(scope()).toBe('t3|org-b|ok'));
  });

  it('writes the URL when the team is switched', async () => {
    renderAt('/app/tickets?status=open');
    // Wait for the stamp, not just the selection, so the switch isn't racing it.
    await waitFor(() => expect(window.location.search).toBe('?status=open&team=t1'));
    act(() => ctx.setSelectedTeamId('t2'));
    expect(window.location.search).toBe('?status=open&team=t2');
    expect(scope()).toBe('t2|org-a|ok');
  });

  it('follows Back/Forward to another team', async () => {
    renderAt('/app/dashboard?team=t1');
    await waitFor(() => expect(scope()).toBe('t1|org-a|ok'));
    act(() => {
      window.history.replaceState(null, '', '/app/dashboard?team=t2');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(scope()).toBe('t2|org-a|ok');
  });

  it('never falls back to another team when the URL names one the user is not in', async () => {
    renderAt('/app/dashboard?team=other');
    await waitFor(() => expect(scope()).toBe('other|org-a|forbidden'));
    expect(window.location.search).toBe('?team=other');
    expect(localStorage.getItem('app:selectedTeamId:user-1')).toBe('t1');
  });

  it('does not stamp a team onto a resource path', async () => {
    renderAt('/app/tickets/abc');
    await waitFor(() => expect(scope()).toBe('t1|org-a|ok'));
    expect(window.location.search).toBe('');
  });

  it('sends a bare /app/teams to the selected team page', async () => {
    renderAt('/app/teams?tab=pending&teamId=t2');
    await waitFor(() => expect(window.location.pathname).toBe('/app/teams/t2'));
    expect(window.location.search).toBe('?tab=pending');
    expect(scope()).toBe('t2|org-a|ok');
  });

  it('selects the team named in a /app/teams/:teamId path', async () => {
    renderAt('/app/teams/t3');
    await waitFor(() => expect(scope()).toBe('t3|org-b|ok'));
    expect(window.location.search).toBe('');
  });

  it('moves the team page path when the team is switched', async () => {
    renderAt('/app/teams/t1');
    await waitFor(() => expect(scope()).toBe('t1|org-a|ok'));
    act(() => ctx.setSelectedTeamId('t2'));
    expect(window.location.pathname).toBe('/app/teams/t2');
  });

  it('shows no access for a team page the user is not in', async () => {
    renderAt('/app/teams/other');
    await waitFor(() => expect(scope()).toBe('other|org-a|forbidden'));
  });

  it('treats a just-created team as accessible before the list refetches', async () => {
    renderAt('/app/teams/t1');
    await waitFor(() => expect(scope()).toBe('t1|org-a|ok'));
    act(() => ctx.setSelectedTeamId('new', team('new', 'org-a')));
    expect(window.location.pathname).toBe('/app/teams/new');
    expect(scope()).toBe('new|org-a|ok');
  });

  it('ignores ?team= on a resource path', async () => {
    renderAt('/app/tickets/abc?team=other');
    await waitFor(() => expect(scope()).toBe('t1|org-a|ok'));
  });

  it('drops the URL team when the org is switched', async () => {
    renderAt('/app/dashboard?team=t1');
    await waitFor(() => expect(scope()).toBe('t1|org-a|ok'));
    act(() => ctx.setSelectedOrgId('org-b'));
    await waitFor(() => expect(scope()).toBe('t3|org-b|ok'));
    expect(window.location.search).toBe('?team=t3');
  });
});
