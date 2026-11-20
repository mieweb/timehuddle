import { describe, expect, it } from 'vitest';

import {
  anyTeamPulseInApp,
  backgroundWorkAllowed,
  pulseSurfacesVisible,
  recordingAllowed,
} from './visibility';

const on = { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: false };
const off = { pulseInApp: false, pulseClockInOut: false, pulseSharedDevice: false };

describe('pulseSurfacesVisible (§7.2)', () => {
  it('shows when Pulse is available and a team has Pulse in the app on', () => {
    expect(pulseSurfacesVisible({ available: true, teams: { a: off, b: on }, unsent: 0 })).toBe(
      true,
    );
  });

  it('keeps showing with the setting off everywhere while videos are unsent (AD25)', () => {
    expect(pulseSurfacesVisible({ available: true, teams: { a: off }, unsent: 2 })).toBe(true);
    expect(pulseSurfacesVisible({ available: true, teams: {}, unsent: 1 })).toBe(true);
  });

  it('hides with the setting off everywhere and nothing unsent', () => {
    expect(pulseSurfacesVisible({ available: true, teams: { a: off }, unsent: 0 })).toBe(false);
    expect(pulseSurfacesVisible({ available: true, teams: null, unsent: null })).toBe(false);
  });

  it('never shows where Pulse is not available (web, no plugin, unsupported)', () => {
    expect(pulseSurfacesVisible({ available: false, teams: { a: on }, unsent: 3 })).toBe(false);
  });

  it('reads a team without the field as off', () => {
    expect(anyTeamPulseInApp({ a: {} })).toBe(false);
  });
});

describe('backgroundWorkAllowed (AD34)', () => {
  it('runs when the server says Pulse is not paused', () => {
    expect(backgroundWorkAllowed({ available: true, runtimePaused: false })).toBe(true);
  });

  it('skips while paused, and before the server has said', () => {
    expect(backgroundWorkAllowed({ available: true, runtimePaused: true })).toBe(false);
    expect(backgroundWorkAllowed({ available: true, runtimePaused: null })).toBe(false);
  });

  it('skips where Pulse is not available', () => {
    expect(backgroundWorkAllowed({ available: false, runtimePaused: false })).toBe(false);
  });
});

describe('recordingAllowed', () => {
  it('needs a team with the setting on, and no pause', () => {
    const base = { available: true, unsent: 0 };
    expect(recordingAllowed({ ...base, runtimePaused: false, teams: { a: on } })).toBe(true);
    expect(recordingAllowed({ ...base, runtimePaused: false, teams: { a: off } })).toBe(false);
    expect(recordingAllowed({ ...base, runtimePaused: true, teams: { a: on } })).toBe(false);
  });
});
