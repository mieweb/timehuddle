/**
 * OtaUpdateGate — blocks the app when the running bundle is below the channel's
 * published minVersion. Routine updates are left to the plugin's background
 * swap; this is only the kill switch for a release that must not keep running.
 *
 * Children render immediately and the overlay mounts on top once the check
 * confirms the running bundle is too old. Blocking every cold start behind a
 * network round-trip would add startup delay on exactly the slow connections
 * this gate exists to serve. The user cannot dismiss it — they wait for the
 * download to finish and the WebView to reload. Failed downloads offer a retry.
 *
 * Fails open: if the backend is unreachable the user gets straight through,
 * because a device that can't reach the server can't download the update either.
 */
import { Button, Spinner } from '@mieweb/ui';
import React from 'react';

import { applyForcedUpdate, checkForcedUpdate, type ForcedUpdate } from '../lib/ota';

type Phase = 'downloading' | 'restarting' | 'failed';

/**
 * `set()` reloads the WebView, so the gate normally disappears with the whole
 * page. If the reload does not arrive, the user would otherwise sit at a full
 * progress bar forever with nothing to press — so fall back to the retry.
 */
const RESTART_TIMEOUT_MS = 15000;

export const OtaUpdateGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [update, setUpdate] = React.useState<ForcedUpdate | null>(null);
  const [phase, setPhase] = React.useState<Phase>('downloading');
  const [percent, setPercent] = React.useState(0);
  const restartTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(restartTimer.current), []);

  React.useEffect(() => {
    let cancelled = false;
    void checkForcedUpdate()
      .then((pending) => {
        if (!cancelled && pending) setUpdate(pending);
      })
      // checkForcedUpdate resolves null rather than throwing, but failing open
      // is the gate's contract — make that true at the call site too, instead
      // of depending on the callee never rejecting.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const run = React.useCallback(async (required: ForcedUpdate) => {
    setPhase('downloading');
    setPercent(0);
    try {
      await applyForcedUpdate(required, setPercent);
      // Reaching here means the WebView has not reloaded yet. Wait a beat for
      // it, then offer a way out rather than spinning indefinitely.
      setPhase('restarting');
      restartTimer.current = window.setTimeout(() => setPhase('failed'), RESTART_TIMEOUT_MS);
    } catch {
      setPhase('failed');
    }
  }, []);

  React.useEffect(() => {
    if (update) void run(update);
  }, [update, run]);

  return (
    <>
      {children}

      {update && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
          aria-labelledby="ota-gate-title"
          aria-describedby="ota-gate-description"
          className="ota-update-gate fixed inset-0 z-[2147483647] flex items-center justify-center bg-white px-6 dark:bg-neutral-950"
        >
          <div className="ota-update-gate-panel flex w-full max-w-sm flex-col items-center gap-5 text-center">
            {phase !== 'failed' ? (
              <>
                <Spinner size="lg" />
                <div className="space-y-1.5">
                  <h1
                    id="ota-gate-title"
                    className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
                  >
                    Updating TimeHuddle
                  </h1>
                  <p
                    id="ota-gate-description"
                    className="text-sm text-neutral-500 dark:text-neutral-400"
                  >
                    {phase === 'restarting'
                      ? 'Update installed. Restarting TimeHuddle…'
                      : "A new version is downloading. The app will restart when it's ready."}
                  </p>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Update download progress"
                  className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
                >
                  <div
                    className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out dark:bg-blue-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
                  v{update.running} → v{update.version}
                </p>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <h1
                    id="ota-gate-title"
                    className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
                  >
                    Update failed
                  </h1>
                  <p
                    id="ota-gate-description"
                    className="text-sm text-neutral-500 dark:text-neutral-400"
                  >
                    TimeHuddle couldn&apos;t download the update. Check your connection and try
                    again.
                  </p>
                </div>
                <Button variant="primary" onClick={() => void run(update)}>
                  Try again
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
