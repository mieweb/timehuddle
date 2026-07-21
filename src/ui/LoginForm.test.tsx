import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ddpMocks = vi.hoisted(() => ({
  signUpWithPassword: vi.fn(),
  loginWithPassword: vi.fn(),
  getTeamInvitation: vi.fn(),
  acceptTeamInvitation: vi.fn(),
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
    devMemberSignIn: vi.fn(),
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

import { LoginForm } from './LoginForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

describe('LoginForm team invitations', () => {
  it('shows the invited team and accepts after account creation', async () => {
    const token = 'a'.repeat(64);
    window.history.replaceState(null, '', `/app?mode=signup&invite=${token}`);
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
      expect(ddpMocks.acceptTeamInvitation).toHaveBeenCalledWith(token);
    });
  });

  it('shows an actionable error for an unavailable invitation', async () => {
    window.history.replaceState(null, '', `/app?mode=signup&invite=${'b'.repeat(64)}`);
    ddpMocks.getTeamInvitation.mockRejectedValue(new Error('This invitation has expired.'));

    render(<LoginForm />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/invitation has expired/i);
  });
});

describe('LoginForm dev sign-in gate', () => {
  it('does not render the dev card in production mode', () => {
    vi.stubEnv('MODE', 'production');

    render(<LoginForm />);

    expect(screen.queryByText('Domain')).toBeNull();
    expect(screen.queryByText('Login Type')).toBeNull();
    expect(screen.queryByText('Join a team')).toBeNull();
  });

  it('renders the dev card outside production mode', () => {
    vi.stubEnv('MODE', 'development');

    render(<LoginForm />);

    expect(screen.getByText('Domain')).toBeTruthy();
    expect(screen.getByText('Login Type')).toBeTruthy();
  });
});
