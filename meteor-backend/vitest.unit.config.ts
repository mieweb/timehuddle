import { readdirSync, readFileSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

/**
 * The backend tests that need no running Meteor server or database: every test
 * file that imports neither `./helpers` (which talks to the test backend on
 * :3101) nor `mongodb` (a database of its own). These run in CI
 * (`npm run test:unit`, see .github/workflows/checks.yml); the rest still need
 * the test backend, see tests/setup.ts.
 */
const NEEDS_A_SERVER = /from '(\.\/helpers|mongodb)'/;
const unitTests = readdirSync('tests')
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => !NEEDS_A_SERVER.test(readFileSync(`tests/${name}`, 'utf8')))
  .map((name) => `tests/${name}`);

export default defineConfig({
  test: {
    globals: true,
    include: unitTests,
  },
});
