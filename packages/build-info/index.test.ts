import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseCommitLog, readBuildInfo } from './index.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'build-info-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, subject: string, file = 'file.txt'): void {
  writeFileSync(path.join(cwd, file), subject);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', subject);
}

function repo(): string {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

/** A repo with one commit on main and a `feature` branch checked out from it. */
function featureRepo(): string {
  const dir = repo();
  commit(dir, 'on main');
  git(dir, 'checkout', '-q', '-b', 'feature');
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseCommitLog', () => {
  it('splits each line into sha, date and subject', () => {
    expect(parseCommitLog('abc123\t2026-11-25T10:00:00-05:00\tfix: a\tb')).toEqual([
      { sha: 'abc123', date: '2026-11-25T10:00:00-05:00', subject: 'fix: a\tb' },
    ]);
  });

  it('is empty for no output', () => {
    expect(parseCommitLog(null)).toEqual([]);
    expect(parseCommitLog('')).toEqual([]);
  });
});

describe('readBuildInfo', () => {
  it('lists the commits a branch build has that main does not', () => {
    const dir = featureRepo();
    commit(dir, 'second');
    commit(dir, 'third');

    const info = readBuildInfo({ cwd: dir, version: '1.1.0', now: new Date(0) });

    expect(info).toMatchObject({
      version: '1.1.0',
      builtAt: '1970-01-01T00:00:00.000Z',
      branch: 'feature',
      dirty: false,
      baseRef: 'main',
      commitsAhead: 2,
    });
    expect(info.commit).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(info.commits.map((c) => c.subject)).toEqual(['third', 'second']);
  });

  it('lists nothing for a build of main', () => {
    const dir = repo();
    commit(dir, 'first');
    commit(dir, 'second');

    const info = readBuildInfo({ cwd: dir });

    expect(info).toMatchObject({ branch: 'main', commitsAhead: 0, commits: [] });
  });

  it("leaves out main's own work merged into the branch", () => {
    const dir = featureRepo();
    commit(dir, 'on the branch');
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'later on main', 'main.txt');
    git(dir, 'checkout', '-q', 'feature');
    git(dir, 'merge', '-q', '--no-edit', 'main');

    const info = readBuildInfo({ cwd: dir });

    expect(info.commitsAhead).toBe(1);
    expect(info.commits.map((c) => c.subject)).toEqual(['on the branch']);
  });

  it("compares against the remote's main over a local one", () => {
    const dir = featureRepo();
    const shipped = git(dir, 'rev-parse', 'HEAD');
    commit(dir, 'on the branch');
    git(dir, 'update-ref', 'refs/remotes/origin/main', shipped);
    git(dir, 'branch', '-q', '-f', 'main', 'HEAD');

    const info = readBuildInfo({ cwd: dir });

    expect(info).toMatchObject({ baseRef: 'origin/main', commitsAhead: 1 });
  });

  it("defaults the version to the repository root's package.json", () => {
    const dir = repo();
    writeFileSync(path.join(dir, 'package.json'), '{"version":"2.3.4"}');
    commit(dir, 'only');

    expect(readBuildInfo({ cwd: dir }).version).toBe('2.3.4');
  });

  it('caps the list but keeps the exact count', () => {
    const dir = featureRepo();
    for (const n of [1, 2, 3]) commit(dir, `change ${n}`);

    const info = readBuildInfo({ cwd: dir, commitLimit: 2 });

    expect(info.commitsAhead).toBe(3);
    expect(info.commits).toHaveLength(2);
  });

  it('flags uncommitted changes and a detached HEAD', () => {
    const dir = featureRepo();
    git(dir, 'checkout', '-q', '--detach');
    writeFileSync(path.join(dir, 'file.txt'), 'edited');

    const info = readBuildInfo({ cwd: dir });

    expect(info.dirty).toBe(true);
    expect(info.branch).toBeNull();
    expect(info.commitsAhead).toBe(0);
  });

  it('has nothing to compare against without a main', () => {
    const dir = tempDir();
    git(dir, 'init', '-q', '-b', 'trunk');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    commit(dir, 'only');

    const info = readBuildInfo({ cwd: dir });

    expect(info).toMatchObject({ branch: 'trunk', baseRef: null, commitsAhead: null, commits: [] });
  });

  it('degrades to nulls outside a repository', () => {
    const info = readBuildInfo({ cwd: tempDir(), version: '1.0.0' });

    expect(info).toMatchObject({
      version: '1.0.0',
      commit: null,
      branch: null,
      dirty: null,
      baseRef: null,
      commits: [],
    });
  });
});
