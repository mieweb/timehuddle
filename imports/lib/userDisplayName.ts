type UserLike =
  | { profile?: { firstName?: string; lastName?: string }; emails?: Array<{ address?: string }> }
  | null
  | undefined;

/** Display name for UI + push copy (matches teams/messages helpers). */
export function getUserDisplayName(user: UserLike, fallback = 'Unknown'): string {
  const p = user?.profile as { firstName?: string; lastName?: string } | undefined;
  if (p?.firstName || p?.lastName) return [p.firstName, p.lastName].filter(Boolean).join(' ');
  return user?.emails?.[0]?.address?.split('@')[0] ?? fallback;
}
