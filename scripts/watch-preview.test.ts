import { describe, expect, it, vi } from 'vitest';

import { watchPreview, watchVideoId, withPreview } from './watch-preview.mjs';

const VIDEO = '2fe388d4-d08c-4f0c-a91d-454dc50771fe';
const BACKEND = 'https://timecore.example.org';
const PAGE = `https://huddle.example.org/watch/${VIDEO}`;

/** A backend that knows one video, with a poster when `poster` is set. */
function backend({
  name = 'Standup',
  poster = true,
}: { name?: string | null; poster?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/api/videos_publicInfo')) {
      return new Response(
        JSON.stringify({ result: { name, addedAt: '2026-10-29T19:44:19.422Z', author: null } }),
      );
    }
    if (url.endsWith('/poster')) {
      return poster
        ? new Response('x', { status: 206, headers: { 'Content-Type': 'image/jpeg' } })
        : new Response('', { status: 404 });
    }
    return new Response('x', { status: 206, headers: { 'Content-Type': 'video/mp4' } });
  }) as unknown as typeof fetch;
}

describe('watchVideoId', () => {
  it('reads a watch path, and nothing else', () => {
    expect(watchVideoId(`/watch/${VIDEO}`)).toBe(VIDEO);
    expect(watchVideoId(`/watch/${VIDEO.toUpperCase()}/`)).toBe(VIDEO);
    for (const path of [
      '/watch/',
      '/watch/not-a-video',
      `/app/watch/${VIDEO}`,
      `/watch/${VIDEO}/x`,
    ]) {
      expect(watchVideoId(path)).toBeNull();
    }
  });
});

describe('watchPreview', () => {
  it("cards the video's name, its poster and the video itself", async () => {
    const html = withPreview(
      '<head><title>TimeHuddle</title></head>',
      (await watchPreview(VIDEO, { backendUrl: BACKEND, fetchImpl: backend() }))!,
      PAGE,
    );
    expect(html).toContain('<title>Standup · TimeHuddle</title>');
    expect(html).toContain('<meta property="og:title" content="Standup" />');
    expect(html).toContain(`<meta property="og:url" content="${PAGE}" />`);
    expect(html).toContain(
      `<meta property="og:image" content="${BACKEND}/pulsevault/artifacts/${VIDEO}/poster" />`,
    );
    expect(html).toContain(
      `<meta property="og:video:secure_url" content="${BACKEND}/pulsevault/artifacts/${VIDEO}" />`,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('added Oct 29, 2026');
  });

  it('goes without an image when the video has no poster', async () => {
    const preview = await watchPreview(VIDEO, {
      backendUrl: BACKEND,
      fetchImpl: backend({ poster: false }),
    });
    const html = withPreview('<title>x</title>', preview!, PAGE);
    expect(html).not.toContain('og:image');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('escapes a name, which is the uploader’s own text', async () => {
    const preview = await watchPreview(VIDEO, {
      backendUrl: BACKEND,
      fetchImpl: backend({ name: '"/><script>alert(1)</script>' }),
    });
    const html = withPreview('<title>x</title>', preview!, PAGE);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;/&gt;&lt;script&gt;');
  });

  it('is null for a video the backend doesn’t have, so the page goes out plain', async () => {
    const missing = vi.fn(
      async () => new Response('{}', { status: 404 }),
    ) as unknown as typeof fetch;
    expect(await watchPreview(VIDEO, { backendUrl: BACKEND, fetchImpl: missing })).toBeNull();
  });
});
