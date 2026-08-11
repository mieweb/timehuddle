import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Capacitor } from '@capacitor/core';

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

import { applyForcedUpdate, checkForcedUpdate } from './ota';

const LATEST = {
  version: '1.0.5',
  url: 'https://timecore-dev.os.mieweb.org/ota/bundles/testflight/1.0.5.zip',
  checksum: 'abc123',
  minVersion: '1.0.4',
};

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
  vi.clearAllMocks();
});

describe('checkForcedUpdate', () => {
  // Vitest runs in mode "test", which is not an OTA channel — the gate is
  // inert there, which is itself the guarantee that dev and web never block.
  it('never gates outside the testflight/production channels', async () => {
    mockLatest(LATEST);
    runningBundle('1.0.1');

    await expect(checkForcedUpdate()).resolves.toBeNull();
  });

  it('never gates on web', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    mockLatest(LATEST);

    await expect(checkForcedUpdate()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails open when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    runningBundle('1.0.1');

    await expect(checkForcedUpdate()).resolves.toBeNull();
  });
});

describe('applyForcedUpdate', () => {
  const update = { ...LATEST, running: '1.0.1' };

  it('downloads the latest bundle and activates it', async () => {
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
    const remove = vi.fn();
    addListener.mockResolvedValue({ remove });
    download.mockRejectedValue(new Error('network'));

    await expect(applyForcedUpdate(update, vi.fn())).rejects.toThrow('network');
    expect(remove).toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('reports download progress', async () => {
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
