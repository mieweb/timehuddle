import { Meteor } from 'meteor/meteor';

/** Display name for UI + push copy (matches teams/messages helpers). */
export function getUserDisplayName(user: Meteor.User | null | undefined, fallback = 'Unknown'): string {
  const p = user?.profile as { firstName?: string; lastName?: string } | undefined;
  if (p?.firstName || p?.lastName) return [p.firstName, p.lastName].filter(Boolean).join(' ');
  return user?.emails?.[0]?.address?.split('@')[0] ?? fallback;
}
