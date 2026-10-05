/**
 * useCopyLink — Copies an absolute link to an in-app path and says so.
 *
 * Every "Copy link" action goes through here, so they all produce the same
 * absolute URL and the same announced feedback (a toast, which is aria-live).
 */
import { Capacitor } from '@capacitor/core';
import { useOptionalToast } from '@mieweb/ui';
import { useCallback } from 'react';

import { METEOR_BASE_URL } from './api';

/** User-facing copy, kept together for translation. */
export const COPY_LINK_COPY = {
  copied: 'Link copied',
  failed: 'Couldn’t copy the link',
};

/**
 * The origin a shared link has to point at.
 *
 * On the web that is simply where the app is being served from. Inside the
 * native shell it is not: `window.location.origin` there is the WebView's own
 * scheme (`capacitor://localhost`), which nobody else can open. Native uses
 * `VITE_PUBLIC_APP_URL`, set by the OTA and TestFlight builds, which verify it
 * reached the bundle.
 *
 * The backend host is only a last resort for a native build made without it
 * (a local `cap run`). It is *not* where the web app lives — the frontend and
 * backend deploy to separate hosts (`huddle` vs `timecore-prod`), so a link
 * built from it won't open TimeHuddle.
 */
export function publicAppOrigin(): string {
  if (!Capacitor.isNativePlatform()) return window.location.origin;
  const configured = (
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string> }).env?.VITE_PUBLIC_APP_URL
      : undefined
  )?.trim();
  return (configured || METEOR_BASE_URL).replace(/\/+$/, '');
}

/** Absolute URL for an in-app path such as `/app/tickets/abc`. */
export function absoluteAppUrl(path: string): string {
  return new URL(path, publicAppOrigin()).toString();
}

export function useCopyLink(): (path: string) => Promise<void> {
  const toast = useOptionalToast();
  return useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(absoluteAppUrl(path));
        toast?.success(COPY_LINK_COPY.copied);
      } catch (err) {
        console.error('[useCopyLink] clipboard write failed:', err);
        toast?.error(COPY_LINK_COPY.failed);
      }
    },
    [toast],
  );
}
