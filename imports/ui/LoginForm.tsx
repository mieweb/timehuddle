import {
  faBolt,
  faClock,
  faShieldHalved,
  faUsers,
  faListCheck,
  faFlask,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Meteor } from 'meteor/meteor';
import React, { useEffect, useState } from 'react';

import { useMethod } from '../lib/useMethod';
import { Button, Input, Text } from '@mieweb/ui';
import { ThemeToggle } from './ThemeToggle';

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthMode = 'login' | 'signup' | 'reset';

interface LoginFormProps {
  initialMode?: AuthMode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMode(): AuthMode {
  if (typeof window === 'undefined') return 'login';
  const params = new URLSearchParams(window.location.search);
  const m = params.get('mode');
  if (m === 'signup') return 'signup';
  if (m === 'reset') return 'reset';
  return 'login';
}

function setModeParam(mode: AuthMode) {
  const url = new URL(window.location.href);
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
  const [mode, setMode] = useState<AuthMode>(initialMode ?? getMode());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const createUser = useMethod<
    [{ email: string; password: string; firstName: string; lastName: string }],
    string
  >('createUserAccount');

  const resetPassword = useMethod<
    [{ email: string; teamCode: string; newPassword: string }],
    boolean
  >('resetPasswordWithTeamCode');

  const isSignup = mode === 'signup';
  const isReset = mode === 'reset';

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setModeParam(next);
    setError(null);
    setResetSuccess(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || loading) return;
    setLoading(true);
    setError(null);
    Meteor.loginWithPassword(email.trim().toLowerCase(), password, (err) => {
      setLoading(false);
      if (err) {
        setError(
          (err as Meteor.Error).reason || (err as Error).message || 'Login failed',
        );
      }
    });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await createUser.call({
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      // Auto-login after signup
      Meteor.loginWithPassword(email.trim().toLowerCase(), password, (err) => {
        setLoading(false);
        if (err) {
          setError(
            (err as Meteor.Error).reason || (err as Error).message || 'Login failed after signup',
          );
        }
      });
    } catch (err: unknown) {
      setLoading(false);
      setError(
        (err as Meteor.Error)?.reason || (err as Error)?.message || 'Signup failed',
      );
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await resetPassword.call({
        email: email.trim().toLowerCase(),
        teamCode: teamCode.trim(),
        newPassword: password,
      });
      setResetSuccess(true);
      setLoading(false);
    } catch (err: unknown) {
      setLoading(false);
      setError(
        (err as Meteor.Error)?.reason || (err as Error)?.message || 'Password reset failed',
      );
    }
  };

  const onSubmit = isReset ? handleReset : isSignup ? handleSignup : handleLogin;

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
              : isReset
                ? 'Reset your password'
                : 'Welcome back'}
          </h1>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-blue-100 lg:text-lg">
            {isSignup
              ? 'Create your account and start tracking time with your team — real-time collaboration built in.'
              : isReset
                ? 'Use your team code to securely reset your password.'
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
                : isReset
                  ? 'Reset your password'
                  : 'Sign in to your account'}
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {isSignup
                ? 'Enter your details to get started'
                : isReset
                  ? 'Use your team code to verify your identity'
                  : 'Enter your email and password'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} noValidate className="space-y-4" aria-live="polite">
            {resetSuccess ? (
              <div className="space-y-4" role="status">
                <div className="rounded-md border border-green-200 bg-green-50/60 p-3 text-sm dark:border-green-700 dark:bg-green-900/30">
                  <p className="leading-relaxed text-green-800 dark:text-green-200">
                    Password reset successfully! You can now sign in with your new password.
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

                {/* Email */}
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

                {/* Team code (reset only) */}
                {isReset && (
                  <Input
                    label="Team code"
                    value={teamCode}
                    onChange={(e) => setTeamCode(e.target.value)}
                    required
                    placeholder="ABCD1234"
                    disabled={loading}
                  />
                )}

                {/* Password */}
                <Input
                  label={isReset ? 'New password' : 'Password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  required
                  autoComplete={isSignup || isReset ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  disabled={loading}
                />

                {/* Confirm password (signup + reset) */}
                {(isSignup || isReset) && (
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
                    : isReset
                      ? 'Reset password'
                      : 'Sign in'}
                </Button>
              </>
            )}
          </form>

          {/* Forgot password (login mode) */}
          {mode === 'login' && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
              >
                Forgot your password?
              </button>
            </div>
          )}

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">or</span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>

          {/* Mode toggle */}
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

          {/* Dev persona picker — only in development */}
          {Meteor.isDevelopment && <DevPersonaPicker />}
        </div>
      </div>
    </div>
  );
};

// ─── Dev Persona Picker ───────────────────────────────────────────────────────

interface PersonaInfo {
  key: string;
  firstName: string;
  lastName: string;
  role: string;
  description: string;
  email: string;
}

const DevPersonaPicker: React.FC = () => {
  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Meteor.call('dev.personas', (err: Meteor.Error | null, result: PersonaInfo[]) => {
      if (!err && result) setPersonas(result);
    });
  }, []);

  const loginAs = (personaKey: string) => {
    setLoading(personaKey);
    setError(null);
    Meteor.call(
      'dev.loginAs',
      personaKey,
      (err: Meteor.Error | null, result: { userId: string; token: string }) => {
        if (err) {
          setLoading(null);
          setError(err.reason || 'Login failed');
          return;
        }
        Meteor.loginWithToken(result.token, (loginErr) => {
          setLoading(null);
          if (loginErr) {
            setError((loginErr as Error).message || 'Token login failed');
          }
        });
      },
    );
  };

  if (personas.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-amber-300/50 bg-amber-50/50 p-4 dark:border-amber-700/50 dark:bg-amber-950/30">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <FontAwesomeIcon icon={faFlask} />
        Dev Quick Login
      </div>

      {error && (
        <p className="mb-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-2">
        {personas.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={loading !== null}
            onClick={() => loginAs(p.key)}
            className="flex w-full items-center gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-blue-600 dark:hover:bg-blue-950/30"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white">
              {p.firstName[0]}{p.lastName[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {p.firstName} {p.lastName}
                </span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  p.role === 'manager'
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                }`}>
                  {p.role}
                </span>
              </div>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {p.description}
              </p>
            </div>
            {loading === p.key && (
              <svg className="h-4 w-4 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
