/**
 * Unit tests for video-names-core (server/video-names-core.js): which URLs are
 * videos, how a name is cleaned, and that old placeholder titles aren't names.
 */
import { describe, it, expect } from 'vitest';

import {
  cleanVideoName,
  mayRenameVideo,
  publicVideoInfo,
  VIDEO_NAME_MAX,
  videoIdOf,
  videoNameOf,
} from '../server/video-names-core';

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

describe('mayRenameVideo', () => {
  const owner = 'user-owner';
  const other = 'user-other';

  it("lets a video's owner rename it, and no one else", () => {
    expect(mayRenameVideo({ item: { userId: owner }, userId: owner })).toBe(true);
    expect(mayRenameVideo({ item: { userId: owner }, userId: other })).toBe(false);
    // PulseVault's record never overrides a media item's owner.
    expect(mayRenameVideo({ item: { userId: owner }, userId: other, uploadedByUser: true })).toBe(false);
  });

  it('lets only its uploader name a video from before every video had a media item', () => {
    expect(mayRenameVideo({ item: null, userId: owner, uploadedByUser: true })).toBe(true);
    // Attaching someone's video URL somewhere proves nothing.
    expect(mayRenameVideo({ item: null, userId: other, uploadedByUser: false })).toBe(false);
  });

  it('lets no one rename while signed out', () => {
    expect(mayRenameVideo({ item: { userId: owner }, userId: undefined })).toBe(false);
    expect(mayRenameVideo({ item: null, userId: null, uploadedByUser: true })).toBe(false);
  });
});

describe('publicVideoInfo', () => {
  const item = { title: 'Standup', userId: 'u1', uploadedAt: new Date('2026-10-29T19:44:19Z') };
  const owner = { profile: { name: 'Dev Owner' }, image: '/uploads/profile/u1.jpg' };

  it('shows anyone with the link the name and date, but not who added it', () => {
    expect(publicVideoInfo({ id: ID, item, viewerId: null, owner, canRename: true })).toEqual({
      videoId: ID,
      name: 'Standup',
      addedAt: item.uploadedAt,
      author: null,
      canRename: false,
    });
  });

  it('shows someone signed in who added it, and Rename only when it says so', () => {
    expect(publicVideoInfo({ id: ID, item, viewerId: 'u2', owner })).toMatchObject({
      author: { name: 'Dev Owner', image: '/uploads/profile/u1.jpg' },
      canRename: false,
    });
    expect(publicVideoInfo({ id: ID, item, viewerId: 'u1', owner, canRename: true }).canRename).toBe(true);
  });

  it('gives a video without a media item no name or date, rather than made-up ones', () => {
    expect(publicVideoInfo({ id: ID, item: null, viewerId: 'u1', owner: null })).toMatchObject({
      name: null,
      addedAt: null,
      author: null,
    });
  });
});
