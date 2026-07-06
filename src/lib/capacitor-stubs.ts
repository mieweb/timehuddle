/**
 * Empty stubs for Capacitor modules when building for web.
 * These modules are only used on native platforms (iOS/Android).
 * The actual Capacitor packages are used when building for native platforms.
 */

// Capacitor core stub
export const Capacitor = {
  getPlatform: () => 'web' as const,
  isNativePlatform: () => false,
  isPluginAvailable: () => false,
};

// WebPlugin stub (used by Capacitor plugins)
export class WebPlugin {
  constructor() {}
  addListener(_eventName: string, _listenerFunc: (...args: unknown[]) => void) {
    return { remove: () => {} };
  }
  removeAllListeners() {}
}

// registerPlugin stub (used by Capacitor plugins)
export function registerPlugin(_pluginName: string, _options?: unknown): any {
  return new Proxy(
    {},
    {
      get() {
        return () => Promise.resolve();
      },
    },
  );
}

// Push Notifications stub
export const PushNotifications = {
  requestPermissions: async () => ({ receive: 'denied' as const }),
  register: async () => {},
  addListener: () => ({ remove: () => {} }),
  removeAllListeners: async () => {},
};

// Device stub
export const Device = {
  getInfo: async () => ({
    model: 'web',
    platform: 'web',
    operatingSystem: 'unknown',
    osVersion: '',
    manufacturer: '',
    isVirtual: false,
    webViewVersion: '',
  }),
};

// Share stub
export const Share = {
  share: async () => ({}),
  canShare: async () => ({ value: false }),
};
