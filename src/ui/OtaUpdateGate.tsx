/**
 * OtaUpdateGate — blocks the app when the running OTA bundle is below the
 * channel's minVersion.
 *
 * Children render immediately and the overlay mounts on top once the check
 * confirms the bundle is stale; blocking every cold start behind a network
 * round-trip would punish the slow connections this gate exists to serve.
 *
 * There is deliberately no dismiss control — that is the whole point of the
 * gate. Failed downloads get a retry instead.
 */
import { Button, Spinner } from '@mieweb/ui';
import React from 'react';

import { applyForcedUpdate, checkForcedUpdate, type ForcedUpdate } from '../lib/ota';

type Phase = 'downloading' | 'failed';

export const OtaUpdateGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [update, setUpdate] = React.useState<ForcedUpdate | null>(null);
  const [phase, setPhase] = React.useState<Phase>('downloading');
  const [percent, setPercent] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void checkForcedUpdate().then((required) => {
      if (!cancelled && required) setUpdate(required);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = React.useCallback(async (required: ForcedUpdate) => {
    setPhase('downloading');
    setPercent(0);
    try {
      // Resolves only on failure — a successful set() reloads the WebView.
      await applyForcedUpdate(required, setPercent);
    } catch {
      setPhase('failed');
    }
  }, []);

  React.useEffect(() => {
    if (update) void run(update);
  }, [update, run]);

  if (!update) return <>{children}</>;

  return (
    <>
      {children}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
        aria-labelledby="ota-gate-title"
        aria-describedby="ota-gate-description"
        className="ota-update-gate fixed inset-0 z-100 flex items-center justify-center bg-white px-6 dark:bg-neutral-950"
      >
        <div className="ota-update-gate-panel flex w-full max-w-sm flex-col items-center gap-5 text-center">
          {phase === 'downloading' ? (
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
                  A required update is downloading. The app will restart when it&apos;s ready.
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
                  TimeHuddle couldn&apos;t download the required update. Check your connection and
                  try again.
                </p>
              </div>
              <Button variant="primary" onClick={() => void run(update)}>
                Try again
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
};
