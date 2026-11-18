/**
 * Unit tests for ota-floors-core (server/ota-floors-core.js): which OTA bundle
 * a device's native shell can run, and what a publish writes per native floor.
 */
import { describe, it, expect } from 'vitest';
import { isNewer } from '@timehuddle/ota-version';

import {
  NO_FLOOR,
  checkAnswer,
  compatibleManifest,
  floorFileName,
  floorFromFileName,
  isValidFloor,
  publishPlan,
} from '../server/ota-floors-core';

type Manifest = {
  version: string;
  file: string;
  checksum: string;
  size?: number;
  publishedAt?: string;
  minVersion?: string;
  nativeFloor?: string;
};

const PUBLIC_URL = 'https://backend.example';
const bundleUrl = (file: string) =>
  `${PUBLIC_URL}/ota/bundles/testflight/${encodeURIComponent(file)}`;

function bundle(version: string, extra: Partial<Manifest> = {}): Manifest {
  return {
    version,
    file: `${version}.zip`,
    checksum: `sum-${version}`,
    size: 100,
    publishedAt: '2026-11-18T00:00:00.000Z',
    ...extra,
  };
}

/** The /ota/check answer as ota.js computed it before floors existed. */
function answerBeforeFloors(latest: Manifest, device: Record<string, string | undefined>) {
  const installed =
    device.version_name && device.version_name !== 'builtin'
      ? device.version_name
      : device.version_build;
  if (!isNewer(latest.version, installed)) return null;
  return {
    version: latest.version,
    url: bundleUrl(latest.file),
    checksum: latest.checksum,
    ...(latest.minVersion ? { minVersion: latest.minVersion } : {}),
  };
}

describe('checkAnswer with native floors', () => {
  // latest needs native 1.4.0; the floors hold the newest bundle per floor.
  const latest = bundle('1.9.0', { nativeFloor: '1.4.0' });
  const floors = [
    bundle('1.5.0', { nativeFloor: NO_FLOOR }),
    bundle('1.7.0', { nativeFloor: '1.1.0' }),
    bundle('1.8.0', { nativeFloor: '1.2.0' }),
    bundle('1.9.0', { nativeFloor: '1.4.0' }),
  ];

  it('gives a device on native 1.2.0 the newest bundle from a floor ≤ 1.2.0, not up_to_date', () => {
    const answer = checkAnswer({
      latest,
      floors,
      device: { version_build: '1.2.0', version_name: 'builtin' },
      bundleUrl,
    });
    expect(answer).toEqual({
      version: '1.8.0',
      url: bundleUrl('1.8.0.zip'),
      checksum: 'sum-1.8.0',
    });
  });

  it('gives a shell between floors the newest bundle below it', () => {
    const answer = checkAnswer({
      latest,
      floors,
      device: { version_build: '1.3.5', version_name: '1.6.0' },
      bundleUrl,
    });
    expect(answer?.version).toBe('1.8.0');
  });

  it('gives a shell at or above the top floor the latest bundle', () => {
    for (const version_build of ['1.4.0', '1.8.5']) {
      const answer = checkAnswer({ latest, floors, device: { version_build }, bundleUrl });
      expect(answer?.version).toBe('1.9.0');
    }
  });

  it('answers up_to_date when the shell already runs its newest compatible bundle', () => {
    const answer = checkAnswer({
      latest,
      floors,
      device: { version_build: '1.2.0', version_name: '1.8.0' },
      bundleUrl,
    });
    expect(answer).toBeNull();
  });

  it('never offers a bundle above the shell’s floor, even when nothing else fits', () => {
    const answer = checkAnswer({
      latest,
      floors: [bundle('1.9.0', { nativeFloor: '1.4.0' })],
      device: { version_build: '1.3.0', version_name: 'builtin' },
      bundleUrl,
    });
    expect(answer).toBeNull();
  });

  it('gives a device that reports no native build only floor-free bundles', () => {
    const answer = checkAnswer({ latest, floors, device: {}, bundleUrl });
    expect(answer?.version).toBe('1.5.0');
  });

  it('prefers latest.json over its own floor copy, for the current minVersion', () => {
    const gated = bundle('1.9.0', { nativeFloor: '1.4.0', minVersion: '1.9.0' });
    const answer = checkAnswer({
      latest: gated,
      floors,
      device: { version_build: '1.4.0' },
      bundleUrl,
    });
    expect(answer?.minVersion).toBe('1.9.0');
  });

  it('drops a minVersion the bundle on offer could never clear', () => {
    const answer = checkAnswer({
      latest: bundle('1.9.0', { nativeFloor: '1.4.0', minVersion: '1.9.0' }),
      floors: [bundle('1.8.0', { nativeFloor: '1.2.0', minVersion: '1.9.0' })],
      device: { version_build: '1.2.0' },
      bundleUrl,
    });
    expect(answer).toEqual({
      version: '1.8.0',
      url: bundleUrl('1.8.0.zip'),
      checksum: 'sum-1.8.0',
    });
  });
});

describe('checkAnswer with no floors published', () => {
  const latests = [
    bundle('1.0.5'),
    bundle('1.0.5', { minVersion: '1.0.4' }),
    bundle('2.0.0-beta.1', { minVersion: '1.0.0' }),
  ];
  const devices = [
    { version_build: '1.0.0', version_name: 'builtin' },
    { version_build: '1.0.0', version_name: '1.0.4' },
    { version_build: '1.0.0', version_name: '1.0.5' },
    { version_build: '1.0.6', version_name: 'builtin' },
    { version_build: '0.9.0' },
    { version_name: '1.0.1' },
    {},
  ];

  it('answers byte for byte what /ota/check answered before floors', () => {
    for (const latest of latests) {
      for (const device of devices) {
        for (const floors of [[], undefined]) {
          const answer = checkAnswer({ latest, floors, device, bundleUrl });
          expect(JSON.stringify(answer)).toBe(JSON.stringify(answerBeforeFloors(latest, device)));
        }
      }
    }
  });

  it('keeps the descriptor’s exact shape and key order', () => {
    const answer = checkAnswer({
      latest: bundle('1.0.5', { minVersion: '1.0.4' }),
      floors: [],
      device: { version_build: '1.0.0', version_name: 'builtin' },
      bundleUrl,
    });
    expect(JSON.stringify(answer)).toBe(
      '{"version":"1.0.5","url":"https://backend.example/ota/bundles/testflight/1.0.5.zip",' +
        '"checksum":"sum-1.0.5","minVersion":"1.0.4"}',
    );
  });
});

describe('compatibleManifest', () => {
  it('is latest.json when no floors exist', () => {
    const latest = bundle('1.0.5');
    expect(compatibleManifest(latest, [], '1.0.0')).toBe(latest);
  });

  it('skips manifests that cannot be served', () => {
    const broken = { version: '9.0.0' } as Manifest;
    const latest = bundle('1.0.5');
    expect(compatibleManifest(latest, [broken], '9.9.9')).toBe(latest);
    expect(compatibleManifest(null, [], '1.0.0')).toBeNull();
  });
});

/** A publish plan that succeeded, typed for the assertions below. */
function planned(args: {
  previous: Manifest | null;
  manifest: Manifest;
  requestedFloor: string | undefined;
}) {
  const plan = publishPlan(args);
  if (!plan.latest || !plan.floorWrites) throw new Error(`refused: ${plan.message}`);
  return plan as { latest: Manifest; floorWrites: { floor: string; manifest: Manifest }[] };
}

describe('publishPlan', () => {
  const now = bundle('1.6.0');

  it('writes only latest.json, unchanged, when no floor is given or in force', () => {
    const plan = publishPlan({
      previous: bundle('1.5.0'),
      manifest: now,
      requestedFloor: undefined,
    });
    expect(plan).toEqual({ latest: now, floorWrites: [] });
    expect(plan.latest).toBe(now);
    expect(publishPlan({ previous: null, manifest: now, requestedFloor: undefined })).toEqual({
      latest: now,
      floorWrites: [],
    });
  });

  it('writes floors/<floor>.json and files the last floor-free bundle under 0.0.0', () => {
    const previous = bundle('1.5.0', { minVersion: '1.4.0' });
    const plan = publishPlan({ previous, manifest: now, requestedFloor: '1.2.0' });
    expect(plan.latest).toEqual({ ...now, nativeFloor: '1.2.0' });
    expect(plan.floorWrites).toEqual([
      { floor: NO_FLOOR, manifest: { ...previous, nativeFloor: NO_FLOOR } },
      { floor: '1.2.0', manifest: { ...now, nativeFloor: '1.2.0' } },
    ]);
  });

  it('carries the floor over to a bundle published without one', () => {
    const previous = bundle('1.6.0', { nativeFloor: '1.2.0' });
    const next = bundle('1.7.0');
    const plan = publishPlan({ previous, manifest: next, requestedFloor: undefined });
    expect(plan.latest.nativeFloor).toBe('1.2.0');
    expect(plan.floorWrites).toEqual([
      { floor: '1.2.0', manifest: { ...next, nativeFloor: '1.2.0' } },
    ]);
  });

  it('refiles the replaced bundle under its own floor when the floor moves', () => {
    const previous = bundle('1.7.0', { nativeFloor: '1.2.0', minVersion: '1.7.0' });
    const next = bundle('1.8.0');
    const plan = planned({ previous, manifest: next, requestedFloor: '1.4.0' });
    expect(plan.floorWrites.map((write) => write.floor)).toEqual(['1.2.0', '1.4.0']);
    expect(plan.floorWrites[0].manifest).toEqual(previous);
  });

  it('refuses a floor that is not a native version, or above the bundle', () => {
    for (const requestedFloor of ['', '1.2', '1.2.0-beta.1', '../1.2.0', 'latest']) {
      expect(publishPlan({ previous: null, manifest: now, requestedFloor }).error).toBe(
        'invalid_native_floor',
      );
    }
    expect(publishPlan({ previous: null, manifest: now, requestedFloor: '1.7.0' }).error).toBe(
      'invalid_native_floor',
    );
    // A floor in force also binds a bundle published without one.
    const previous = bundle('2.0.0', { nativeFloor: '1.9.0' });
    expect(
      publishPlan({ previous, manifest: bundle('1.8.0'), requestedFloor: undefined }).error,
    ).toBe('invalid_native_floor');
  });

  it('feeds checkAnswer: an old shell keeps the bundle the first floor replaced', () => {
    const previous = bundle('1.5.0');
    const plan = planned({ previous, manifest: now, requestedFloor: '1.2.0' });
    const floors = plan.floorWrites.map((write) => write.manifest);
    const old = checkAnswer({
      latest: plan.latest,
      floors,
      device: { version_build: '1.0.0', version_name: 'builtin' },
      bundleUrl,
    });
    const fresh = checkAnswer({
      latest: plan.latest,
      floors,
      device: { version_build: '1.2.0', version_name: '1.5.0' },
      bundleUrl,
    });
    expect(old?.version).toBe('1.5.0');
    expect(fresh?.version).toBe('1.6.0');
  });
});

describe('floor names', () => {
  it('accepts plain native versions only', () => {
    expect(isValidFloor('1.2.0')).toBe(true);
    expect(isValidFloor('1.2.0-beta.1')).toBe(false);
    expect(isValidFloor(undefined)).toBe(false);
  });

  it('maps floors to file names and back, ignoring anything else in the directory', () => {
    expect(floorFileName('1.2.0')).toBe('1.2.0.json');
    expect(floorFromFileName('1.2.0.json')).toBe('1.2.0');
    expect(floorFromFileName('1.2.0.json.ab12.tmp')).toBeNull();
    expect(floorFromFileName('latest.json')).toBeNull();
    expect(floorFromFileName('.DS_Store')).toBeNull();
  });
});
