import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mieweb.timehuddle',
  appName: 'TimeHuddle',
  webDir: 'dist',

  // Load production backend when running on a real device.
  // Overridden during local dev by setting CAPACITOR_SERVER_URL env var or
  // using `npx cap run ios --livereload`.
  server: {
    androidScheme: 'https',
    iosScheme: 'timehuddle',
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
