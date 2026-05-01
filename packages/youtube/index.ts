const YOUTUBE_OEMBED = 'https://www.youtube.com/oembed';

export function isYouTubeUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'www.youtube.com' || hostname === 'youtube.com' || hostname === 'youtu.be';
  } catch {
    return false;
  }
}

export async function getYouTubeTitleFromUrl(url: string): Promise<string | null> {
  try {
    const oembedUrl = `${YOUTUBE_OEMBED}?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title ?? null;
  } catch {
    return null;
  }
}
