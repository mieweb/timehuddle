import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ddpMocks = vi.hoisted(() => ({
  signUpWithPassword: vi.fn(),
  loginWithPassword: vi.fn(),
  getTeamInvitation: vi.fn(),
  acceptTeamInvitation: vi.fn(),
  devQuickLogin: vi.fn(),
}));

vi.mock('../lib/useSession', () => ({
  useSession: () => ({
    user: null,
    loading: false,
    needsUsernameClaim: false,
    refetch: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('../lib/ddp', () => ({
  getDdpClient: () => ddpMocks,
}));

vi.mock('../lib/api', () => ({
  METEOR_BASE_URL: 'http://localhost:3100',
  authApi: {
    signInWithSocial: vi.fn(),
  },
}));

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: () => null,
}));

vi.mock('@mieweb/ui', () => ({
  Button: ({
    children,
    isLoading: _isLoading,
    loadingText: _loadingText,
    fullWidth: _fullWidth,
    ...rest
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <button {...rest}>{children}</button>,
  Input: ({ label, ...rest }: { label?: string; [key: string]: unknown }) => (
    <label>
      {label}
      <input {...rest} />
    </label>
  ),
  Select: ({ label }: { label?: string }) => <label>{label}</label>,
  Text: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <span {...rest}>{children}</span>
  ),
}));

import { captureInviteParams } from '../lib/inviteParams';
import { LoginForm } from './LoginForm';

/**
 * Put the app at `url` as a fresh page load would: the entry point snapshots
 * the invite params while the query string is intact (see lib/inviteParams),
 * so a test that only rewrites the URL is not yet at the state it is testing.
 */
function loadAt(url: string) {
  window.history.replaceState(null, '', url);
  captureInviteParams();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  loadAt('/');
});

describe('LoginForm team invitations', () => {
  it('shows the invited team and accepts after account creation', async () => {
    const token = 'a'.repeat(64);
    loadAt(`/app?mode=signup&invite=${token}`);
    ddpMocks.getTeamInvitation.mockResolvedValue({
      teamName: 'Support',
      email: 'invitee@example.com',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    ddpMocks.signUpWithPassword.mockResolvedValue(undefined);
    ddpMocks.acceptTeamInvitation.mockResolvedValue(undefined);

    render(<LoginForm />);

    expect(await screen.findByText(/you were invited to join support/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Member' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'Password1!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Password1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(ddpMocks.signUpWithPassword).toHaveBeenCalledWith(
        'invitee@example.com',
        'Password1!',
        'New Member',
      );
    });
    // Redeeming belongs to App (see main.tsx), which runs for every way of
    // arriving signed in — password, signup, social OAuth, or an existing
    // session. Doing it here too raced with that and failed the second call.
    expect(ddpMocks.acceptTeamInvitation).not.toHaveBeenCalled();
  });

  it('shows an actionable error for an unavailable invitation', async () => {
    loadAt(`/app?mode=signup&invite=${'b'.repeat(64)}`);
    ddpMocks.getTeamInvitation.mockRejectedValue(new Error('This invitation has expired.'));

    render(<LoginForm />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/invitation has expired/i);
  });
});

describe('LoginForm dev sign-in gate', () => {
  const devCard = () => screen.queryByRole('group', { name: /development sign-in by role/i });

  it('does not render the dev card in a production build', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');

    render(<LoginForm />);

    expect(devCard()).toBeNull();
  });

  // `--mode testflight` is a real build (.github/workflows/testflight.yml) whose
  // backend is production, so it never registers the devQuickLogin handler.
  // Gating on MODE !== 'production' shipped five buttons that always failed.
  it('does not render the dev card in a testflight build', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'testflight');

    render(<LoginForm />);

    expect(devCard()).toBeNull();
  });

  it('renders a sign-in button per role in development', () => {
    vi.stubEnv('DEV', true);

    render(<LoginForm />);

    const group = screen.getByRole('group', { name: /development sign-in by role/i });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Member', 'Org Admin', 'Org Owner', 'Enterprise Admin', 'Enterprise Owner']);
  });

  it('signs in as the clicked role', async () => {
    vi.stubEnv('DEV', true);
    ddpMocks.devQuickLogin.mockResolvedValue(undefined);

    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Org Admin' }));

    await waitFor(() => expect(ddpMocks.devQuickLogin).toHaveBeenCalledWith('org-admin'));
  });
});
