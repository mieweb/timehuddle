/**
 * Unit tests for video-names-core (server/video-names-core.js): which URLs are
 * videos, how a name is cleaned, and that old placeholder titles aren't names.
 */
import { describe, it, expect } from 'vitest';

import { cleanVideoName, VIDEO_NAME_MAX, videoIdOf, videoNameOf } from '../server/video-names-core';

const ID = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

describe('videoIdOf', () => {
  it('reads the id out of a PulseVault playback path, lower-cased', () => {
    expect(videoIdOf(`/pulsevault/artifacts/${ID}`)).toBe(ID);
    expect(videoIdOf(`/pulsevault/artifacts/${ID.toUpperCase()}`)).toBe(ID);
  });

  it('is null for anything else', () => {
    expect(videoIdOf(`https://example.com/pulsevault/artifacts/${ID}`)).toBeNull();
    expect(videoIdOf(`/pulsevault/artifacts/${ID}/poster`)).toBeNull();
    expect(videoIdOf('/pulsevault/artifacts/not-a-uuid')).toBeNull();
    expect(videoIdOf(undefined)).toBeNull();
  });
});

describe('cleanVideoName', () => {
  it('keeps one trimmed line', () => {
    expect(cleanVideoName('  Morning\n standup\twalkthrough  ')).toBe('Morning standup walkthrough');
  });

  it(`cuts a name to ${VIDEO_NAME_MAX} characters`, () => {
    expect(cleanVideoName('a'.repeat(VIDEO_NAME_MAX + 30))).toHaveLength(VIDEO_NAME_MAX);
  });

  it('is null for no name', () => {
    expect(cleanVideoName('   ')).toBeNull();
    expect(cleanVideoName('')).toBeNull();
    expect(cleanVideoName(null)).toBeNull();
    expect(cleanVideoName(42)).toBeNull();
  });
});

describe('videoNameOf', () => {
  it('reads a stored title as its name', () => {
    expect(videoNameOf('Repro of the login bug')).toBe('Repro of the login bug');
  });

  it('reads the old "Video 1a2b3c4d" titles as no name', () => {
    expect(videoNameOf('Video 0b7e7c1e')).toBeNull();
  });

  it('keeps a real name that only starts with "Video"', () => {
    expect(videoNameOf('Video call with design')).toBe('Video call with design');
  });
});
