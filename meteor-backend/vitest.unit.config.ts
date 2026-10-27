import { readdirSync, readFileSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

/**
 * The backend tests that need no running Meteor server or database: every test
 * file that doesn't import `./helpers` (which talks to the test backend on
 * :3101). These run in CI (`npm run test:unit`, see .github/workflows/checks.yml);
 * the rest still need the test backend, see tests/setup.ts.
 */
const unitTests = readdirSync('tests')
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => !/from '\.\/helpers'/.test(readFileSync(`tests/${name}`, 'utf8')))
  .map((name) => `tests/${name}`);

export default defineConfig({
  test: {
    globals: true,
    include: unitTests,
  },
});
