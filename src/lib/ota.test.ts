import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Capacitor } from '@capacitor/core';

import { METEOR_BASE_URL } from './api';

const current = vi.fn();
const download = vi.fn();
const set = vi.fn();
const addListener = vi.fn();
vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: {
    current: (...args: unknown[]) => current(...args),
    download: (...args: unknown[]) => download(...args),
    set: (...args: unknown[]) => set(...args),
    addListener: (...args: unknown[]) => addListener(...args),
  },
}));

// The bundle URL is whatever the backend hands back, so build the fixture from
// the same base the module under test talks to rather than pinning a host.
const LATEST = {
  version: '1.0.5',
  url: `${METEOR_BASE_URL}/ota/bundles/testflight/1.0.5.zip`,
  checksum: 'abc123',
  minVersion: '1.0.4',
};

/**
 * The channel is derived from `import.meta.env.MODE` at module load, so tests
 * that need a live channel have to stub the mode and re-import. Without this
 * the module sees vitest's "test" mode and every check short-circuits to null,
 * which would leave the gate itself — the whole point of the feature —
 * completely uncovered.
 */
async function loadOta(mode: string) {
  vi.stubEnv('MODE', mode);
  vi.resetModules();
  return await import('./ota');
}

function mockLatest(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) } as Response),
  );
}

function runningBundle(version: string, native = '1.0'): void {
  current.mockResolvedValue({ bundle: { id: 'bundle-id', version }, native });
}

beforeEach(() => {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  addListener.mockResolvedValue({ remove: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('checkForcedUpdate — gate fires', () => {
  it('gates a bundle below minVersion', async () => {
    const { checkForcedUpdate } = await loadOta('testflight');
    mockLatest(LATEST);
    runningBundle('1.0.1');

    await expect(checkForcedUpdate()).resolves.toEqual({
      minVersion: '1.0.4',
      version: '1.0.5',
      url: LATEST.url,
      checksum: 'abc123',
      running: '1.0.1',
    });
  });

  it('gates on the production channel too', async () => {
    const { checkForcedUpdate } = await loadOta('production');
    mockLatest(LATEST);
    runningBundle('1.0.1');

    await expect(checkForcedUpdate()).resolves.not.toBeNull();
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('channel=production');
  });

  // Straight after a store install the running bundle reports "builtin", so the
  // native build version is the baseline the gate has to judge.
  it('gates a fresh store install using the native version', async () => {
    const { checkForcedUpdate } = await loadOta('testflight');
    mockLatest(LATEST);
    current.mockResolvedValue({ bundle: { version: 'builtin' }, native: '1.0' });

    await expect(checkForcedUpdate()).resolves.toMatchObject({ running: '1.0' });
  });
});

describe('checkForcedUpdate — gate holds off', () => {
  it('does not gate a bundle exactly at minVersion', async () => {
    const { checkForcedUpdate } = await loadOta('testflight');
    mockLatest(LATEST);
    runningBundle('1.0.4');

    await expect(checkForcedUpdate()).resolves.toBeNull();
  });

  it('does not gate a bundle above minVersion but below latest', async () => {
    const { checkForcedUpdate } = await loadOta('testflight');
    mockLatest(LATEST);
    runningBundle('1.0.4');

    // 1.0.4 is behind latest (1.0.5) — that is the plugin's job, not the gate's.
    await expect(checkForcedUpdate()).resolves.toBeNull();
  });

  it('does not gate when the channel publishes no minVersion', async () => {
    const { checkForcedUpdate } = await loadOta('testflight');
    mockLatest({ version: '1.0.5', url: LATEST.url, checksum: 'abc123' });
    runningBundle('1.0.1');

    await expect(checkForcedUpdate()).resolves.toBeNull();
  });

  it('does not gate when the backend answers non-OK', async () => {
    const { checkForcedUpdate } = await loadOta('testflight');
    mockLatest({ error: 'no_bundle' }, false);
    runningBundle('1.0.1');

    await expect(checkForcedUpdate()).resolves.toBeNull();
  });

  // Vitest runs in mode "test", which is not an OTA channel — the gate is
  // inert there, which is itself the guarantee that dev and web never block.
  it('never gates outside the testflight/production channels', async () => {
    const { checkForcedUpdate } = await loadOta('test');
    mockLatest(LATEST);
    runningBundle('1.0.1');

    await expect(checkForcedUpdate()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never gates on web', async () => {
    const { checkForcedUpdate } = await loadOta('testflight');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    mockLatest(LATEST);

    await expect(checkForcedUpdate()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails open when the backend is unreachable', async () => {
    const { checkForcedUpdate } = await loadOta('testflight');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    runningBundle('1.0.1');

    await expect(checkForcedUpdate()).resolves.toBeNull();
  });
});

describe('applyForcedUpdate', () => {
  const update = { ...LATEST, running: '1.0.1' };

  it('downloads the latest bundle and activates it', async () => {
    const { applyForcedUpdate } = await loadOta('testflight');
    download.mockResolvedValue({ id: 'new-bundle-id' });
    set.mockResolvedValue(undefined);

    await applyForcedUpdate(update);

    expect(download).toHaveBeenCalledWith({
      url: LATEST.url,
      version: LATEST.version,
      checksum: LATEST.checksum,
    });
    expect(set).toHaveBeenCalledWith({ id: 'new-bundle-id' });
  });

  it('removes the progress listener when the download fails', async () => {
    const { applyForcedUpdate } = await loadOta('testflight');
    const remove = vi.fn();
    addListener.mockResolvedValue({ remove });
    download.mockRejectedValue(new Error('network'));

    await expect(applyForcedUpdate(update, vi.fn())).rejects.toThrow('network');
    expect(remove).toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('reports download progress', async () => {
    const { applyForcedUpdate } = await loadOta('testflight');
    const onProgress = vi.fn();
    addListener.mockImplementation((_event: string, cb: (e: { percent: number }) => void) => {
      cb({ percent: 42 });
      return Promise.resolve({ remove: vi.fn() });
    });
    download.mockResolvedValue({ id: 'new-bundle-id' });

    await applyForcedUpdate(update, onProgress);

    expect(onProgress).toHaveBeenCalledWith(42);
  });
});
