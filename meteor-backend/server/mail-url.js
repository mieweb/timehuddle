/**
 * Mail URL builder — pure function, no Meteor imports, so it can be unit
 * tested directly (see tests/mail-url.test.ts) without booting the full
 * Meteor server.
 *
 * Builds the `smtp://` connection string Meteor's `email` package (used by
 * Accounts.sendResetPasswordEmail) expects, from discrete SMTP_* env vars.
 */

/**
 * IPv6 literals (e.g. "::1") must be bracketed inside a URL — otherwise
 * `new URL()` throws ERR_INVALID_URL and the email package silently fails
 * to send (surfaced to the user as "Failed to send reset email").
 */
function bracketIfIPv6(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * @param {{ SMTP_HOST?: string, SMTP_PORT?: string, SMTP_USER?: string, SMTP_PASS?: string, SMTP_SECURE?: string }} env
 * @returns {string | undefined} the MAIL_URL, or undefined if SMTP_HOST isn't set
 */
export function buildMailUrl(env) {
  if (!env.SMTP_HOST) return undefined;
  const smtpHost = bracketIfIPv6(env.SMTP_HOST);
  const smtpPort = env.SMTP_PORT || '587';
  const scheme = env.SMTP_SECURE === 'true' ? 'smtps' : 'smtp';
  const auth = env.SMTP_USER
    ? encodeURIComponent(env.SMTP_USER) + ':' + encodeURIComponent(env.SMTP_PASS || '') + '@'
    : '';
  return scheme + '://' + auth + smtpHost + ':' + smtpPort;
}
