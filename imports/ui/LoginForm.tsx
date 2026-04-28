import {
  faBolt,
  faClock,
  faShieldHalved,
  faUsers,
  faListCheck,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState } from 'react';

import { authApi } from '../lib/api';
import { useSession } from '../lib/useSession';
import { Button, Input, Text } from '@mieweb/ui';
import { ThemeToggle } from './ThemeToggle';

// ─── Types ────────────────────────────────────────────────────────────────────

/** login / signup / forgot = request reset email / reset-confirm = enter new password via token */
type AuthMode = 'login' | 'signup' | 'forgot' | 'reset-confirm';

interface LoginFormProps {
  initialMode?: AuthMode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMode(resetTokenInUrl: boolean): AuthMode {
  if (resetTokenInUrl) return 'reset-confirm';
  if (typeof window === 'undefined') return 'login';
  const params = new URLSearchParams(window.location.search);
  const m = params.get('mode');
  if (m === 'signup') return 'signup';
  if (m === 'forgot') return 'forgot';
  return 'login';
}

function setModeParam(mode: AuthMode) {
  const url = new URL(window.location.href);
  // Remove any reset token when explicitly switching modes
  url.searchParams.delete('token');
  url.searchParams.set('mode', mode);
  window.history.replaceState(null, '', url.toString());
}

// ─── Marketing panel bullets ──────────────────────────────────────────────────

const FEATURES = [
  { icon: faClock, text: 'Real-time clock in/out with team visibility' },
  { icon: faListCheck, text: 'Ticket tracking with individual timers' },
  { icon: faUsers, text: 'Team dashboards with member activity' },
  { icon: faBolt, text: 'Instant real-time sync — no polling, no REST' },
  { icon: faShieldHalved, text: 'Role-based access with admin controls' },
] as const;

export const LoginForm: React.FC<LoginFormProps> = ({ initialMode }) => {
  const session = useSession();

  const resetToken =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('token') ?? undefined)
      : undefined;

  const [mode, setMode] = useState<AuthMode>(initialMode ?? getMode(!!resetToken));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const isResetConfirm = mode === 'reset-confirm';

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setModeParam(next);
    setError(null);
    setSuccessMessage(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || loading) return;
    setLoading(true);
    setError(null);
    try {
      await authApi.signIn(email.trim().toLowerCase(), password);
      await session.refetch();
    } catch (err: unknown) {
      setError((err as Error).message || 'Login failed');
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      await authApi.signUp(email.trim().toLowerCase(), password, name);
      // Sign in immediately after signup to establish the session cookie
      await authApi.signIn(email.trim().toLowerCase(), password);
      await session.refetch();
    } catch (err: unknown) {
      setLoading(false);
      setError((err as Error).message || 'Signup failed');
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || loading) return;
    setLoading(true);
    setError(null);
    try {
      const redirectTo = `${window.location.origin}/app`;
      await authApi.requestPasswordReset(email.trim().toLowerCase(), redirectTo);
      setSuccessMessage('Check your email for a reset link.');
    } catch (err: unknown) {
      setError((err as Error).message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResetConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken || loading) return;
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword(resetToken, password);
      // Clear token from URL and go to login with success message
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      url.searchParams.set('mode', 'login');
      window.history.replaceState(null, '', url.toString());
      setMode('login');
      setPassword('');
      setConfirmPassword('');
      setSuccessMessage('Password reset successfully. You can now sign in.');
    } catch (err: unknown) {
      setError((err as Error).message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = isResetConfirm
    ? handleResetConfirm
    : isForgot
      ? handleForgot
      : isSignup
        ? handleSignup
        : handleLogin;

  // ── Marketing panel (left) ──────────────────────────────────────────────────

  const MarketingPanel = () => (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 p-10 text-white md:flex md:w-1/2 lg:p-14">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-white/10" />

      <div className="relative z-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">
            {isSignup
              ? 'Start tracking in minutes'
              : isForgot || isResetConfirm
                ? 'Reset your password'
                : 'Welcome back'}
          </h1>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-blue-100 lg:text-lg">
            {isSignup
              ? 'Create your account and start tracking time with your team — real-time collaboration built in.'
              : isForgot || isResetConfirm
                ? "Enter your email address and we'll send you a link to reset your password."
                : 'Sign in to pick up where you left off. Your data syncs in real-time.'}
          </p>
        </div>

        <ul className="space-y-3">
          {FEATURES.map(({ icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-blue-100">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                <FontAwesomeIcon icon={icon} className="text-sm" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 mt-8 flex items-center gap-3 border-t border-white/20 pt-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
          TH
        </div>
        <div>
          <p className="text-sm font-semibold">TimeHuddle</p>
          <p className="text-xs text-blue-200">Real-time Team Collaboration</p>
        </div>
      </div>
    </div>
  );

  // ── Layout ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen w-full font-sans text-neutral-800 dark:text-neutral-100">
      <MarketingPanel />

      <div className="relative flex w-full flex-col items-center justify-center px-6 py-12 md:w-1/2 md:px-12 lg:px-20">
        {/* Top bar */}
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          {/* Mobile-only branding */}
          <div className="mb-8 md:hidden">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
              TimeHuddle
            </h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Team Time Tracking & Collaboration
            </p>
          </div>

          {/* Heading */}
          <div className="mb-6 space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
              {isSignup
                ? 'Create your account'
                : isForgot
                  ? 'Forgot your password?'
                  : isResetConfirm
                    ? 'Set a new password'
                    : 'Sign in to your account'}
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {isSignup
                ? 'Enter your details to get started'
                : isForgot
                  ? "Enter your email and we'll send a reset link"
                  : isResetConfirm
                    ? 'Enter and confirm your new password'
                    : 'Enter your email and password'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} noValidate className="space-y-4" aria-live="polite">
            {successMessage ? (
              <div className="space-y-4" role="status">
                <div className="rounded-md border border-green-200 bg-green-50/60 p-3 text-sm dark:border-green-700 dark:bg-green-900/30">
                  <p className="leading-relaxed text-green-800 dark:text-green-200">
                    {successMessage}
                  </p>
                </div>
                <Button
                  variant="primary"
                  fullWidth
                  type="button"
                  onClick={() => switchMode('login')}
                >
                  Go to Sign In
                </Button>
              </div>
            ) : (
              <>
                {/* Name fields (signup only) */}
                {isSignup && (
                  <div className="flex gap-3">
                    <Input
                      label="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      autoComplete="given-name"
                      placeholder="Jane"
                      disabled={loading}
                    />
                    <Input
                      label="Last name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      autoComplete="family-name"
                      placeholder="Doe"
                      disabled={loading}
                    />
                  </div>
                )}

                {/* Email (login / signup / forgot) */}
                {!isResetConfirm && (
                  <Input
                    label="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    placeholder="you@example.com"
                    disabled={loading}
                  />
                )}

                {/* Password (login / signup / reset-confirm) */}
                {!isForgot && (
                  <Input
                    label={isResetConfirm ? 'New password' : 'Password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    required
                    autoComplete={isSignup || isResetConfirm ? 'new-password' : 'current-password'}
                    placeholder="••••••••"
                    disabled={loading}
                  />
                )}

                {/* Confirm password (signup + reset-confirm) */}
                {(isSignup || isResetConfirm) && (
                  <Input
                    label="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="••••••••"
                    disabled={loading}
                  />
                )}

                {error && (
                  <Text variant="destructive" size="xs" weight="medium" as="div" role="alert">
                    {error}
                  </Text>
                )}

                <Button
                  variant="primary"
                  fullWidth
                  type="submit"
                  disabled={loading}
                  isLoading={loading}
                  loadingText="Please wait…"
                >
                  {isSignup
                    ? 'Create account'
                    : isForgot
                      ? 'Send reset link'
                      : isResetConfirm
                        ? 'Set new password'
                        : 'Sign in'}
                </Button>
              </>
            )}
          </form>

          {/* Forgot password (login mode only) */}
          {mode === 'login' && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
              >
                Forgot your password?
              </button>
            </div>
          )}

          {/* Mode toggle (login ↔ signup only) */}
          {(mode === 'login' || mode === 'signup') && (
            <>
              {/* Divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
                <span className="text-xs text-neutral-400 dark:text-neutral-500">or</span>
                <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              </div>

              <p className="text-center text-sm text-neutral-600 dark:text-neutral-400">
                {isSignup ? (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signup')}
                      className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Sign up
                    </button>
                  </>
                )}
              </p>
            </>
          )}

          {/* Back to sign in (forgot / reset-confirm) */}
          {(isForgot || isResetConfirm) && !successMessage && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
