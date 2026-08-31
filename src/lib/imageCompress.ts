/**
 * Shrink an image before it goes over the wire.
 *
 * A phone camera photo is 3–8 MB at 4032×3024, and nothing in the app ever
 * displays one larger than a feed column — so the upload spends most of its
 * time sending pixels that are thrown away on render. Downscaling to
 * {@link MAX_DIMENSION} and re-encoding typically cuts a camera photo to a few
 * hundred KB, which is the difference between an upload that feels instant and
 * one that feels broken.
 *
 * Everything here is best-effort: any failure, or any result that isn't
 * actually smaller, returns the original file untouched.
 */

/** Longest edge kept, in CSS pixels. Comfortably above any display size. */
const MAX_DIMENSION = 2048;

const QUALITY = 0.82;

/** Below this, re-encoding costs more than it saves. */
const MIN_COMPRESSIBLE_BYTES = 300 * 1024;

/**
 * Formats worth re-encoding. GIF (animation) and SVG (vector) are excluded —
 * a canvas round-trip would flatten them to a single raster frame. AVIF is
 * already smaller than anything we'd produce.
 */
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Photographs re-encode best as JPEG, but PNG/WebP sources may carry
 * transparency (pasted screenshots, logos), which JPEG would flatten to black.
 * WebP keeps the alpha channel and still compresses far better than PNG.
 */
function outputTypeFor(sourceType: string): string {
  return sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
}

function renameExtension(filename: string, mimeType: string): string {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  const base = filename.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${ext}`;
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/**
 * Downscale and re-encode an image file for upload. Returns the original file
 * unchanged when it isn't a compressible image, is already small, or when
 * compressing wouldn't actually save bytes.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!COMPRESSIBLE_TYPES.has(file.type) || file.size < MIN_COMPRESSIBLE_BYTES) return file;
  if (typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await toBlob(canvas, outputTypeFor(file.type));
    // Nothing gained (already well compressed, or the browser ignored the
    // requested format and handed back something bigger) — keep the original.
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], renameExtension(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
