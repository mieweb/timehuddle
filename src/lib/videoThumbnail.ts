/**
 * extractVideoThumbnail
 *
 * Extracts a JPEG thumbnail from a video File using the browser's
 * <video> + <canvas> APIs. Seeks to the middle of the video so the
 * frame is representative rather than a blank first frame.
 *
 * Returns a JPEG Blob at 640×360 (or the video's native aspect ratio
 * if it differs), suitable for uploading to the thumbnail endpoint.
 */
export function extractVideoThumbnail(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  return extractThumbnailFromVideoUrl(objectUrl).finally(() => URL.revokeObjectURL(objectUrl));
}

/**
 * extractThumbnailFromVideoUrl
 *
 * Same as extractVideoThumbnail but accepts a URL string directly.
 * Use this for videos that are already uploaded and have a public URL.
 *
 * If `targetSeconds` is provided, extraction seeks to that timestamp;
 * otherwise it falls back to the midpoint.
 */
export function extractThumbnailFromVideoUrl(url: string, targetSeconds?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    video.addEventListener('error', () => {
      reject(new Error('Failed to load video for thumbnail extraction'));
    });

    video.addEventListener('loadedmetadata', () => {
      const hasTarget = typeof targetSeconds === 'number' && Number.isFinite(targetSeconds);
      const safeTarget = hasTarget
        ? Math.max(0, Math.min(targetSeconds, video.duration || 0))
        : null;
      const seekTo = safeTarget ?? video.duration / 2;
      video.currentTime = isFinite(seekTo) && seekTo > 0 ? seekTo : 0;
    });

    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas');

      const maxWidth = 640;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context not available'));
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas toBlob returned null'));
          }
        },
        'image/jpeg',
        0.85,
      );
    });

    video.src = url;
  });
}
