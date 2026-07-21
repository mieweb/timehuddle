/**
 * invitation-helpers — shared email-invitation utilities.
 *
 * Extracted from teams.js so the same token/hash/email/status logic can be
 * reused by the organization-invitation flow (orgs.invite / orgs.acceptInvite
 * / etc. in organizations.js) without duplicating it.
 */
import { createHash, randomBytes } from 'crypto';

export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_APP_URL = 'http://localhost:3000';
export const APP_URL = (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/$/, '');

export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function generateInvitationToken() {
  return randomBytes(32).toString('hex');
}

export function hashInvitationToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
