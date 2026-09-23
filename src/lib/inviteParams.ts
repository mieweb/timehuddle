/**
 * Invite context carried in the URL (`?join=`, `?invite=`, `?org_invite=`),
 * captured by the entry point before React mounts.
 *
 * Two reasons it lives here rather than being read where it is used:
 *
 *  1. It has to be captured early. AppLayout resolves `/app` to
 *     `/app/dashboard` inside a useState initializer — during render, before
 *     any effect runs — and drops the query string on the way (resolveUrl in
 *     AppLayout.tsx). Code that reads window.location from an effect finds
 *     nothing whenever the visitor is already signed in.
 *
 *  2. It has to be consumed once. Both the sign-in flow (LoginForm, once it
 *     has authenticated) and the signed-in flow (main.tsx, when a session
 *     appears) can be the one to redeem it, and redeeming an email invitation
 *     twice fails the second time — the first call marks it accepted.
 *
 * So: `capture` once at startup, `peek` to read it (naming the team before
 * sign-in), `take` to claim it.
 */
export interface InviteParams {
  join: string | null;
  invite: string | null;
  orgInvite: string | null;
}

function readFromUrl(): InviteParams | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const join = params.get('join');
  const invite = params.get('invite');
  const orgInvite = params.get('org_invite');
  if (!join && !invite && !orgInvite) return null;
  return { join, invite, orgInvite };
}

let captured: InviteParams | null = null;
let hasCaptured = false;

/**
 * Snapshot the invite params. The entry point calls this as it loads, which is
 * the last moment the query string is still intact.
 */
export function captureInviteParams(): void {
  captured = readFromUrl();
  hasCaptured = true;
}

/**
 * Nothing captured means no entry point ran — a component rendered on its own,
 * as in a unit test — so the URL is still the source of truth.
 */
function current(): InviteParams | null {
  return hasCaptured ? captured : readFromUrl();
}

/** Read the pending invite context without claiming it. */
export function peekInviteParams(): InviteParams | null {
  return current();
}

/** Claim the pending invite context — subsequent callers get null. */
export function takeInviteParams(): InviteParams | null {
  const claimed = current();
  captured = null;
  hasCaptured = true;
  return claimed;
}
