import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compareUiInstall } from './check-ui-tarball.mjs';

/**
 * Regression coverage for #814: a stale installed @mieweb/ui must fail the
 * guard even though its package.json version string is unchanged, and a
 * matching install must pass.
 */
describe('compareUiInstall', () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'check-ui-tarball-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /** Packs a fake @mieweb/ui payload (same version, different dist content) into a tarball. */
  function buildTarball(label, distContent) {
    const src = join(workDir, `src-${label}`);
    mkdirSync(join(src, 'package', 'dist'), { recursive: true });
    writeFileSync(
      join(src, 'package', 'package.json'),
      JSON.stringify({ name: '@mieweb/ui', version: '0.11.0' }),
    );
    writeFileSync(join(src, 'package', 'dist', 'index.js'), distContent);
    const tarballPath = join(workDir, `${label}.tgz`);
    execFileSync('tar', ['-czf', tarballPath, '-C', src, 'package']);
    return tarballPath;
  }

  it('rejects a stale installed payload sharing the same package version', () => {
    const originalTarball = buildTarball('original', 'console.log("v1 — no document kind");');
    const newTarball = buildTarball('new', 'console.log("v2 — document kind enabled");');

    // Simulate production: install the original build once...
    const installedDir = join(workDir, 'installed');
    mkdirSync(installedDir, { recursive: true });
    execFileSync('tar', ['-xzf', originalTarball, '-C', installedDir, '--strip-components=1']);

    // ...then the committed tarball moves on (same version, new content) but the
    // installed copy is never refreshed — exactly what an incremental `npm install` did in #814.
    const result = compareUiInstall({ tarballPath: newTarball, installedDir });

    expect(result.ok).toBe(false);
    expect(result.changed).toContain('dist/index.js');
  });

  it('accepts a matching installed payload', () => {
    const tarball = buildTarball('matching', 'console.log("same build");');
    const installedDir = join(workDir, 'installed');
    mkdirSync(installedDir, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', installedDir, '--strip-components=1']);

    const result = compareUiInstall({ tarballPath: tarball, installedDir });

    expect(result.ok).toBe(true);
    expect(result.changed).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('fails clearly when the package was never installed', () => {
    const tarball = buildTarball('uninstalled', 'console.log("v1");');
    const result = compareUiInstall({
      tarballPath: tarball,
      installedDir: join(workDir, 'does-not-exist'),
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/npm install/);
  });

  it('skips the check when no tarball is present (not this repo)', () => {
    const result = compareUiInstall({
      tarballPath: join(workDir, 'no-such-tarball.tgz'),
      installedDir: join(workDir, 'installed'),
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('flags files present only in the installed copy as extra', () => {
    const tarball = buildTarball('base', 'console.log("base");');
    const installedDir = join(workDir, 'installed');
    mkdirSync(installedDir, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', installedDir, '--strip-components=1']);
    writeFileSync(join(installedDir, 'dist', 'leftover-chunk.js'), 'stale chunk');

    const result = compareUiInstall({ tarballPath: tarball, installedDir });

    expect(result.ok).toBe(false);
    expect(result.extra).toContain('dist/leftover-chunk.js');
  });
});
