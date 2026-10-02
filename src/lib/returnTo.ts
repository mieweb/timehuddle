/**
 * returnTo — Brings a signed-out visitor back to the link they opened.
 *
 * Opening `/app/...` without a session shows the sign-in form at `/`, which
 * used to lose the link. The link is kept in sessionStorage (this tab only)
 * and restored once, on the first signed-in render, before the router reads
 * the URL. An explicit sign-out clears it, so signing back in starts fresh.
 *
 * Native deep links (timehuddle://open/...) have their own hand-off through
 * `pendingDeepLinkPath` in main.tsx/AppLayout; this covers web URLs.
 */
const RETURN_TO_KEY = 'auth:returnTo';

/** Only in-app pages are worth returning to. */
function isAppPath(pathname: string): boolean {
  return pathname.startsWith('/app/');
}

/** Saves the current URL if it's an in-app page. Call before leaving it for sign-in. */
export function rememberReturnTo(): void {
  const { pathname, search } = window.location;
  if (!isAppPath(pathname)) return;
  try {
    sessionStorage.setItem(RETURN_TO_KEY, pathname + search);
  } catch {
    // Storage unavailable (private mode) — the user lands on the dashboard.
  }
}

/**
 * Where signing in lands: `/` after the password form, `/app/dashboard` after
 * an OAuth round trip. Only there does the saved link take over.
 */
const SIGN_IN_LANDINGS = new Set(['/', '/app', '/app/dashboard']);

/**
 * Moves the browser back to the saved URL, once, if it has just come from
 * signing in. Returns whether it did. The saved URL is dropped either way, so
 * a stale one (from a session that blipped out and back) never overrides a
 * page the user opened since. A landing that carries its own query (an invite
 * or join link) wins over the saved one.
 */
export function restoreReturnTo(): boolean {
  let target: string | null = null;
  try {
    target = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    return false;
  }
  const { pathname, search } = window.location;
  if (!target || !isAppPath(target)) return false;
  if (!SIGN_IN_LANDINGS.has(pathname) || search) return false;
  window.history.replaceState(null, '', target);
  return true;
}

export function forgetReturnTo(): void {
  try {
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // Nothing to forget.
  }
}
