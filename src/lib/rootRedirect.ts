/**
 * Sends a signed-in visitor from `/` straight to the dashboard.
 *
 * The check is synchronous: the stored resume token is the signal, so a signed-out
 * visitor gets the landing page with no wait and a signed-in one never sees it.
 * A token the server no longer accepts is removed by the first resume attempt,
 * so a stale one costs one trip through the sign-in form, not a loop.
 */
const DASHBOARD_PATH = '/app/dashboard';

/** Replaces `/` with the dashboard when a session token exists. Returns whether it did. */
export function redirectSignedInRootToDashboard(): boolean {
  if (window.location.pathname !== '/') return false;
  if (!localStorage.getItem('meteor_resume_token')) return false;
  // Replace, not push: Back must not return to `/` and bounce forward again.
  window.history.replaceState(null, '', DASHBOARD_PATH + window.location.search);
  return true;
}
