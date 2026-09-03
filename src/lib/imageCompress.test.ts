import { afterEach, describe, expect, it, vi } from 'vitest';

import { compressImageForUpload } from './imageCompress';

/**
 * jsdom has no canvas or ImageBitmap, so the encode path is stubbed: the fake
 * canvas reports whichever format it was asked for and a caller-chosen size.
 * The real pixel work is verified in a browser, not here — what these tests
 * pin down is which files get re-encoded, into what, and when the original
 * wins.
 */
function stubCanvas(encodedBytes: number) {
  const toBlob = vi.fn((cb: BlobCallback, type: string) => {
    cb(new Blob([new Uint8Array(encodedBytes)], { type }));
  });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4032, height: 3024, close() {} })),
  );
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
    return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob } as never;
  });
  return { toBlob };
}

function imageFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/**
 * A WebP file whose header says whether it animates: "RIFF"…"WEBP" then either
 * a plain "VP8 " chunk (a still) or "VP8X" with the animation bit set.
 */
function webpFile(name: string, bytes: number, { animated }: { animated: boolean }): File {
  const buf = new Uint8Array(bytes);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) buf[offset + i] = text.charCodeAt(i);
  };
  write(0, 'RIFF');
  write(8, 'WEBP');
  write(12, animated ? 'VP8X' : 'VP8 ');
  if (animated) buf[20] = 0x02;
  return new File([buf], name, { type: 'image/webp' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('compressImageForUpload', () => {
  it('re-encodes a camera photo as JPEG and renames it to match', async () => {
    stubCanvas(400 * 1024);
    const file = imageFile('IMG_4821.JPG', 'image/jpeg', 5 * 1024 * 1024);

    const out = await compressImageForUpload(file);

    expect(out).not.toBe(file);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('IMG_4821.jpg');
    expect(out.size).toBeLessThan(file.size);
  });

  it('re-encodes PNG as WebP so pasted screenshots keep their transparency', async () => {
    stubCanvas(400 * 1024);
    const file = imageFile('Screenshot.png', 'image/png', 6 * 1024 * 1024);

    const out = await compressImageForUpload(file);

    expect(out.type).toBe('image/webp');
    expect(out.name).toBe('Screenshot.webp');
  });

  it('keeps the original when re-encoding would not save anything', async () => {
    stubCanvas(9 * 1024 * 1024);
    const file = imageFile('already-tiny-for-its-size.jpg', 'image/jpeg', 4 * 1024 * 1024);

    expect(await compressImageForUpload(file)).toBe(file);
  });

  it('leaves documents, animations, and vectors alone', async () => {
    stubCanvas(1024);
    const pdf = imageFile('report.pdf', 'application/pdf', 4 * 1024 * 1024);
    const gif = imageFile('anim.gif', 'image/gif', 4 * 1024 * 1024);
    const svg = imageFile('logo.svg', 'image/svg+xml', 4 * 1024 * 1024);

    expect(await compressImageForUpload(pdf)).toBe(pdf);
    expect(await compressImageForUpload(gif)).toBe(gif);
    expect(await compressImageForUpload(svg)).toBe(svg);
  });

  it('re-encodes a still WebP', async () => {
    stubCanvas(400 * 1024);
    const file = webpFile('still.webp', 4 * 1024 * 1024, { animated: false });

    const out = await compressImageForUpload(file);

    expect(out).not.toBe(file);
    expect(out.type).toBe('image/webp');
  });

  it('leaves an animated WebP alone — a canvas round-trip keeps one frame', async () => {
    stubCanvas(400 * 1024);
    const file = webpFile('anim.webp', 4 * 1024 * 1024, { animated: true });

    expect(await compressImageForUpload(file)).toBe(file);
  });

  it('leaves small images alone', async () => {
    stubCanvas(1024);
    const file = imageFile('thumb.jpg', 'image/jpeg', 100 * 1024);

    expect(await compressImageForUpload(file)).toBe(file);
  });

  it('falls back to the original when decoding fails', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failed');
      }),
    );
    const file = imageFile('broken.jpg', 'image/jpeg', 4 * 1024 * 1024);

    expect(await compressImageForUpload(file)).toBe(file);
  });
});
