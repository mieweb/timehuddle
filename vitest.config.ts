import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      // Shared with the backend, so its tests run here too, and in CI (#734).
      'packages/ticket-sources/**/*.test.ts',
      // Run by the frontend's own server, so tested with it.
      'scripts/**/*.test.ts',
    ],
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@lib': path.resolve(__dirname, 'src/lib'),
    },
  },
});
