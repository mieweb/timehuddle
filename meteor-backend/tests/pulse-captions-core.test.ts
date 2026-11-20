/**
 * Unit tests for pulse-captions-core (server/pulse-captions-core.js): what
 * `GET /pulse/captions/:videoId` answers, which of a pulse's files are its
 * captions, and the URL a client plays them from. The last block runs the
 * real PulseVault core on a scratch directory: it finds a video's captions
 * with `getPulse`, and serves the `.vtt` the route redirects to as
 * `text/vtt` — why the route redirects instead of proxying.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalStorage, createPulseVaultCore } from '@mieweb/pulsevault/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ARTIFACT_ID,
  BACKFILL_BATCH,
  CAPTIONS_CONTENT_TYPE,
  artifactPathOf,
  captionsIdOf,
  captionsUrlOf,
  isArtifactId,
  routeDecision,
  videoIdFromPath,
} from '../server/pulse-captions-core';

const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';
const CAPTIONS = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const meta = (artifactId: string, kind: string, ext: string, extra = {}) => ({
  artifactId,
  kind,
  ext,
  filename: `x${ext}`,
  ready: true,
  ...extra,
});

describe('isArtifactId', () => {
  it("takes a UUID in any case, as PulseVault's own check does", () => {
    expect(isArtifactId(VIDEO)).toBe(true);
    expect(isArtifactId(VIDEO.toUpperCase())).toBe(true);
    expect(ARTIFACT_ID.test(CAPTIONS)).toBe(true);
  });

  it('refuses anything else', () => {
    for (const id of ['', 'abc', `${VIDEO}x`, `../${VIDEO}`, VIDEO.replace(/-/g, ''), null, undefined, 42]) {
      expect(isArtifactId(id)).toBe(false);
    }
  });
});

describe('captionsUrlOf', () => {
  it("is the captions artifact's playback path, path-only like every stored URL", () => {
    expect(captionsUrlOf({ captionsId: CAPTIONS })).toBe(`/pulsevault/artifacts/${CAPTIONS}`);
    expect(artifactPathOf(CAPTIONS)).toBe(`/pulsevault/artifacts/${CAPTIONS}`);
  });

  it('is null for an item with no captions, none known yet, or no item', () => {
    expect(captionsUrlOf({ captionsId: null })).toBeNull();
    expect(captionsUrlOf({ videoid: VIDEO })).toBeNull();
    expect(captionsUrlOf(null)).toBeNull();
    expect(captionsUrlOf(undefined)).toBeNull();
  });

  it('never builds a URL out of a stored value that is not an artifact id', () => {
    expect(captionsUrlOf({ captionsId: '../../etc/passwd' })).toBeNull();
    expect(captionsUrlOf({ captionsId: { $ne: null } })).toBeNull();
  });
});

describe('captionsIdOf', () => {
  it("is a video's finished WebVTT captions", () => {
    const pulse = { video: meta(VIDEO, 'video', '.mp4'), captions: meta(CAPTIONS, 'captions', '.vtt') };
    expect(captionsIdOf(pulse)).toBe(CAPTIONS);
  });

  it('is null for SubRip captions, which a <track> cannot play', () => {
    const pulse = { video: meta(VIDEO, 'video', '.mp4'), captions: meta(CAPTIONS, 'captions', '.srt') };
    expect(captionsIdOf(pulse)).toBeNull();
  });

  it('is null for a video without captions, an unknown id, or an id that is not a video', () => {
    expect(captionsIdOf({ video: meta(VIDEO, 'video', '.mp4') })).toBeNull();
    expect(captionsIdOf({ video: null })).toBeNull();
    expect(captionsIdOf(null)).toBeNull();
    expect(
      captionsIdOf({ video: meta(VIDEO, 'thumbnail', '.jpg'), captions: meta(CAPTIONS, 'captions', '.vtt') }),
    ).toBeNull();
  });

  it('is null for captions not finished yet', () => {
    const pulse = {
      video: meta(VIDEO, 'video', '.mp4'),
      captions: meta(CAPTIONS, 'captions', '.vtt', { ready: false }),
    };
    expect(captionsIdOf(pulse)).toBeNull();
  });
});

describe('routeDecision', () => {
  it('is a 400 for a malformed id, without a lookup', async () => {
    const lookup = vi.fn(async () => CAPTIONS);
    for (const id of [null, '', 'not-a-uuid', `${VIDEO}.vtt`]) {
      expect(await routeDecision(id, lookup)).toMatchObject({ status: 400 });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('is a 404 for a video with no captions', async () => {
    const lookup = vi.fn(async () => null);
    expect(await routeDecision(VIDEO, lookup)).toMatchObject({ status: 404 });
    expect(lookup).toHaveBeenCalledWith(VIDEO);
  });

  it('redirects (302) to the captions artifact, rather than proxying it', async () => {
    expect(await routeDecision(VIDEO, async () => CAPTIONS)).toEqual({
      status: 302,
      location: `/pulsevault/artifacts/${CAPTIONS}`,
    });
  });

  it('lets a failed lookup throw, for the route to answer 500', async () => {
    await expect(
      routeDecision(VIDEO, async () => {
        throw new Error('disk');
      }),
    ).rejects.toThrow('disk');
  });
});

describe('videoIdFromPath', () => {
  it("reads the id after the mount, with or without a slash or query", () => {
    expect(videoIdFromPath(`/${VIDEO}`)).toBe(VIDEO);
    expect(videoIdFromPath(`/${VIDEO}/`)).toBe(VIDEO);
    expect(videoIdFromPath(`/${VIDEO}?v=2`)).toBe(VIDEO);
  });

  it('is null for no id, a deeper path or a broken escape', () => {
    expect(videoIdFromPath('/')).toBeNull();
    expect(videoIdFromPath('')).toBeNull();
    expect(videoIdFromPath(`/${VIDEO}/extra`)).toBeNull();
    expect(videoIdFromPath('/%E0%A4%A')).toBeNull();
    expect(videoIdFromPath(undefined)).toBeNull();
  });
});

describe('the backfill batch', () => {
  it('is 100 items', () => {
    expect(BACKFILL_BATCH).toBe(100);
  });
});

describe('against the real PulseVault core', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let core: ReturnType<typeof createPulseVaultCore>;
  const SRT = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
  const BARE = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

  /** Store a finished artifact the way a finished upload leaves it. */
  async function store(
    storage: ReturnType<typeof createLocalStorage>,
    artifactId: string,
    kind: 'video' | 'captions',
    ext: string,
    body: string,
    relatedTo?: string,
  ) {
    const rel = await storage.reserveUpload({ artifactId, filename: `f${ext}`, ext, kind, relatedTo });
    await writeFile(path.join(storage.workspaceRoot, rel), body);
    await storage.markReady!(artifactId);
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pulse-captions-'));
    const storage = createLocalStorage({ workspaceDir: dir });
    await storage.initialize!();
    await store(storage, VIDEO, 'video', '.mp4', 'not really an mp4');
    await store(storage, CAPTIONS, 'captions', '.vtt', 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n', VIDEO);
    await store(storage, BARE, 'video', '.mp4', 'no captions');
    await store(storage, SRT, 'captions', '.srt', '1\n00:00:00,000 --> 00:00:01,000\nHello\n', BARE);
    core = createPulseVaultCore({
      storage,
      basePath: '/pulsevault',
      stripBasePath: false,
      maxUploadSize: 1024 * 1024,
      allowedExtensions: { captions: ['.vtt', '.srt'] },
      replayCompletions: false,
    });
    server = createServer((req, res) => {
      core.handler(req, res, () => {
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  it("finds a video's .vtt captions with getPulse, and none for a video with only .srt", async () => {
    expect(captionsIdOf(await core.getPulse(VIDEO))).toBe(CAPTIONS);
    expect(captionsIdOf(await core.getPulse(BARE))).toBeNull();
    expect(captionsIdOf(await core.getPulse(CAPTIONS))).toBeNull();
  });

  it('serves the artifact the route redirects to as text/vtt, so a redirect is enough', async () => {
    const decision = await routeDecision(VIDEO, async (id: string) => captionsIdOf(await core.getPulse(id)));
    expect(decision.status).toBe(302);
    // The mount strips /pulsevault before the core's handler, as in pulsevault.js.
    const res = await fetch(base + decision.location!.replace(/^\/pulsevault/, ''));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(CAPTIONS_CONTENT_TYPE);
    expect(await res.text()).toMatch(/^WEBVTT/);
  });
});
