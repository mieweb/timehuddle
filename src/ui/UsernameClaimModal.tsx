/**
 * UsernameClaimModal — shown after a user's first social signup.
 *
 * Forces the user to choose a canonical TimeHuddle username before accessing the app.
 * Username is globally unique, 3–30 chars, lowercase alphanumeric + _ -.
 */
import React, { useEffect, useId, useState } from 'react';

import { usernameApi } from '../lib/api';
import { useSession } from '../lib/useSession';
import { Button, Input, Text } from '@mieweb/ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a username candidate for comparison and submission. */
function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Derive a username suggestion from a display name. */
function suggestUsername(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 28)
    .padEnd(3, '0');
}

const USERNAME_HINT =
  '3–30 characters · letters, numbers, _ or - · must start and end with a letter or number';

// ─── Error messages ──────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  'too-short': 'Username must be at least 3 characters.',
  'too-long': 'Username must be 30 characters or fewer.',
  'invalid-chars':
    'Only letters, numbers, _ and - are allowed, and it must start and end with a letter or number.',
  blocked: 'That username is reserved. Please choose a different one.',
  taken: 'That username is already taken.',
  'already-claimed': 'You have already claimed a username.',
};

// ─── Component ────────────────────────────────────────────────────────────────

export const UsernameClaimModal: React.FC = () => {
  const { user, refetch } = useSession();
  const labelId = useId();

  const [username, setUsername] = useState(() => (user?.name ? suggestUsername(user.name) : ''));
  const [availability, setAvailability] = useState<
    'idle' | 'checking' | 'available' | 'unavailable'
  >('idle');
  const [availabilityReason, setAvailabilityReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounced availability check
  useEffect(() => {
    const normalized = normalizeUsername(username);
    if (normalized.length < 3) {
      setAvailability('idle');
      setAvailabilityReason(null);
      return;
    }

    setAvailability('checking');
    const timer = setTimeout(async () => {
      try {
        const result = await usernameApi.check(normalized);
        if (result.available) {
          setAvailability('available');
          setAvailabilityReason(null);
        } else {
          setAvailability('unavailable');
          setAvailabilityReason(
            result.reason ? (ERROR_MESSAGES[result.reason] ?? result.reason) : null,
          );
        }
      } catch {
        setAvailability('idle');
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeUsername(username);
    if (!normalized || loading) return;
    setLoading(true);
    setError(null);

    try {
      await usernameApi.claim(normalized);
      // Refresh session so needsUsernameClaim becomes false
      await refetch();
    } catch (err: unknown) {
      const msg = (err as Error).message ?? 'Failed to claim username';
      setError(ERROR_MESSAGES[msg] ?? msg);
      setLoading(false);
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl dark:bg-neutral-900">
        {/* Heading */}
        <div className="mb-6 space-y-2">
          <h2
            id={labelId}
            className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50"
          >
            Choose your username
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Pick a unique handle for your TimeHuddle profile. You&apos;ll use this to share your
            profile URL and identify yourself in the app.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <Input
              label="Username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              type="text"
              required
              autoComplete="username"
              spellCheck={false}
              placeholder="your-handle"
              disabled={loading}
              aria-describedby="username-hint username-status"
            />

            {/* Live availability feedback */}
            <p
              id="username-status"
              className={
                'mt-1 text-xs ' +
                (availability === 'available'
                  ? 'text-green-600 dark:text-green-400'
                  : availability === 'unavailable'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-neutral-400 dark:text-neutral-500')
              }
              aria-live="polite"
            >
              {availability === 'checking' && 'Checking…'}
              {availability === 'available' && `✓ @${normalizeUsername(username)} is available`}
              {availability === 'unavailable' &&
                (availabilityReason ?? 'That username is not available.')}
            </p>

            <p id="username-hint" className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              {USERNAME_HINT}
            </p>
          </div>

          {error && (
            <Text variant="destructive" size="xs" weight="medium" as="div" role="alert">
              {error}
            </Text>
          )}

          <Button
            variant="primary"
            fullWidth
            type="submit"
            disabled={loading || availability !== 'available'}
            isLoading={loading}
            loadingText="Claiming…"
          >
            Claim username
          </Button>
        </form>
      </div>
    </div>
  );
};
