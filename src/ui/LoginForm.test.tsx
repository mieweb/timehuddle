import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/useSession', () => ({
  useSession: () => ({
    user: null,
    loading: false,
    needsUsernameClaim: false,
    refetch: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  authApi: {
    signInWithSocial: vi.fn(),
    devMemberSignIn: vi.fn(),
  },
}));

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: () => null,
}));

vi.mock('@mieweb/ui', () => ({
  Button: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <button {...rest}>{children}</button>
  ),
  Input: ({ label }: { label?: string }) => <label>{label}</label>,
  Select: ({ label }: { label?: string }) => <label>{label}</label>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

import { LoginForm } from './LoginForm';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
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
