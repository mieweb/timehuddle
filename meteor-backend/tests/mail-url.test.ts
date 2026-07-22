/**
 * Unit tests for buildMailUrl (server/mail-url.js).
 *
 * Regression coverage for the bug where SMTP_HOST="::1" (Mailpit's IPv6
 * loopback, used to dodge a local port-1025 squatter — see
 * ecosystem.config.cjs) produced an unbracketed "smtp://::1:1025" MAIL_URL.
 * Node's `new URL()` (used internally by Meteor's `email` package) rejects
 * that as ERR_INVALID_URL, which silently broke Accounts.sendResetPasswordEmail
 * and surfaced to users as "Failed to send reset email. Please try again later."
 */
import { describe, it, expect } from 'vitest';
import { buildMailUrl } from '../server/mail-url';

describe('buildMailUrl', () => {
  it('returns undefined when SMTP_HOST is not set', () => {
    expect(buildMailUrl({})).toBeUndefined();
  });

  it('brackets an IPv6 loopback host (the Mailpit regression case)', () => {
    expect(buildMailUrl({ SMTP_HOST: '::1', SMTP_PORT: '1025' })).toBe('smtp://[::1]:1025');
  });

  it('brackets a full IPv6 address', () => {
    expect(buildMailUrl({ SMTP_HOST: '2001:db8::1', SMTP_PORT: '587' })).toBe(
      'smtp://[2001:db8::1]:587',
    );
  });

  it('does not double-bracket an already-bracketed host', () => {
    expect(buildMailUrl({ SMTP_HOST: '[::1]', SMTP_PORT: '1025' })).toBe('smtp://[::1]:1025');
  });

  it('leaves an IPv4 host untouched', () => {
    expect(buildMailUrl({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025' })).toBe(
      'smtp://127.0.0.1:1025',
    );
  });

  it('leaves a hostname untouched', () => {
    expect(buildMailUrl({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587' })).toBe(
      'smtp://smtp.example.com:587',
    );
  });

  it('defaults to port 587 when SMTP_PORT is not set', () => {
    expect(buildMailUrl({ SMTP_HOST: 'smtp.example.com' })).toBe('smtp://smtp.example.com:587');
  });

  it('uses the smtps scheme when SMTP_SECURE is "true"', () => {
    expect(buildMailUrl({ SMTP_HOST: 'smtp.example.com', SMTP_SECURE: 'true' })).toBe(
      'smtps://smtp.example.com:587',
    );
  });

  it('includes url-encoded credentials when SMTP_USER is set', () => {
    expect(
      buildMailUrl({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a b', SMTP_PASS: 'p@ss' }),
    ).toBe('smtp://a%20b:p%40ss@smtp.example.com:587');
  });

  it('omits the password segment when SMTP_USER is set without SMTP_PASS', () => {
    expect(buildMailUrl({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'user' })).toBe(
      'smtp://user:@smtp.example.com:587',
    );
  });

  it('produces a MAIL_URL that new URL() can parse without throwing', () => {
    const url = buildMailUrl({ SMTP_HOST: '::1', SMTP_PORT: '1025' })!;
    expect(() => new URL(url)).not.toThrow();
    // Node's URL.hostname keeps the brackets for IPv6 literals.
    expect(new URL(url).hostname).toBe('[::1]');
    expect(new URL(url).port).toBe('1025');
  });
});
