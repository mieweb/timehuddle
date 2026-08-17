/// <reference types="@capgo/capacitor-updater" />
import type { CapacitorConfig } from '@capacitor/cli';

// When CAPACITOR_SERVER_URL is set (e.g. http://10.0.0.8:3000) the WebView
// loads from the Vite dev server for live reload instead of the bundled dist.
// Unset (or absent) means serve the built bundle from webDir.
const liveReloadUrl = process.env.CAPACITOR_SERVER_URL;

// OTA live updates (@capgo/capacitor-updater, self-hosted on the Meteor backend).
// Hosts are hardcoded rather than read from .env.* because those files are
// gitignored and therefore absent in CI, where `npx cap sync` runs.
const OTA_BACKENDS: Record<string, string> = {
  testflight: 'https://timecore-dev.os.mieweb.org',
  production: 'https://timecore-prod.os.mieweb.org',
};
const otaChannel = process.env.OTA_CHANNEL || 'production';
const otaBackend = process.env.OTA_BACKEND_URL || OTA_BACKENDS[otaChannel];
const otaUpdateUrl = otaBackend
  ? `${otaBackend.replace(/\/+$/, '')}/ota/check?channel=${encodeURIComponent(otaChannel)}`
  : undefined;

const config: CapacitorConfig = {
  appId: 'com.mieweb.timehuddle',
  appName: 'TimeHuddle',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    // iosScheme must NOT be 'http' or 'https' — WKWebView handles those
    // natively as real network requests, causing 19s+ networking process
    // launch times and watchdog kills. Default ('capacitor') is correct.
    ...(liveReloadUrl ? { url: liveReloadUrl, cleartext: true } : {}),
  },

  plugins: {
    // @capacitor/app — register custom URL scheme for deep links.
    // The scheme "timehuddle" is used for password-reset deep links:
    //   timehuddle://reset?token=XXX
    App: {},

    CapacitorUpdater: {
      // Normal OTA updates still happen via the plugin; the OtaUpdateGate only blocks
      // when the backend declares the running bundle below minVersion.
      autoUpdate: liveReloadUrl ? 'off' : 'atBackground',
      updateUrl: otaUpdateUrl,
      // Self-hosted: no Capgo cloud, so no stats or channel endpoints.
      statsUrl: '',
      channelUrl: '',
      // Drop OTA bundles when a newer native build is installed from the store.
      resetWhenUpdate: true,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      appReadyTimeout: 10000,
    },

    PushNotifications: {
      // On iOS, present notifications even when the app is in the foreground.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
