import type { CapacitorConfig } from '@capacitor/cli';

// When CAPACITOR_SERVER_URL is set (e.g. http://10.0.0.8:3000) the WebView
// loads from the Vite dev server for live reload instead of the bundled dist.
// Unset (or absent) means serve the built bundle from webDir.
const liveReloadUrl = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.mieweb.timehuddle',
  appName: 'TimeHuddle',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    ...(liveReloadUrl ? { url: liveReloadUrl, cleartext: true } : {}),
  },

  plugins: {
    // @capacitor/app — register custom URL scheme for deep links.
    // The scheme "timehuddle" is used for password-reset deep links:
    //   timehuddle://reset?token=XXX
    App: {},

    PushNotifications: {
      // On iOS, present notifications even when the app is in the foreground.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
