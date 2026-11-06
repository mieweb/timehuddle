/**
 * A video on its way up, drawn like the card it becomes (PulseVideoPlayer):
 * the file's own first frame, dimmed, with how far it has got — then
 * Processing while the server makes it ready to play — and a cancel × while
 * its bytes are still going up. A failed one says why, with Retry.
 */
import { Button, CircularProgress, type AttachmentUpload } from '@mieweb/ui';
import { useState } from 'react';
import { UPLOAD_TEXT } from '../huddle/uploadText';
import { VIDEO_CARD_SIZE, cardBox } from './PulseVideoPlayer';

interface PendingVideoCardProps {
  /** The upload (useAttachmentUploads): its file, state, progress and error. */
  upload: AttachmentUpload<unknown>;
  /**
   * Takes it off: cancels it while its bytes go up, drops it once it failed.
   * Not offered while it's processing (the server delivers it then anyway).
   */
  onRemove: () => void;
  /** Sends a failed one again. */
  onRetry: () => void;
  /** The card's box, as PulseVideoPlayer's. @default VIDEO_CARD_SIZE */
  maxSize?: string;
}

export function PendingVideoCard({
  upload,
  onRemove,
  onRetry,
  maxSize = VIDEO_CARD_SIZE,
}: PendingVideoCardProps) {
  const { file, state, error } = upload;
  // The hook's own preview of the file (revoked when the upload goes).
  const preview = upload.previewUrl;
  // The shape, from the file itself, as the real card learns it from its poster.
  const [aspect, setAspect] = useState<number | null>(null);
  const failed = state === 'failed';
  // Landed but not in the list yet reads as Processing too, till its card shows.
  const processing = state === 'processing' || state === 'uploaded';
  const percent = Math.round(Math.min(1, Math.max(0, upload.progress)) * 100);
  const status = processing ? UPLOAD_TEXT.processing : UPLOAD_TEXT.percent(percent);

  return (
    // The × sits over the corner, outside the clipped frame.
    <div className="pending-video-card relative max-w-full" style={cardBox(aspect, maxSize)}>
      <div
        className="pending-video-frame relative h-full w-full overflow-hidden rounded-2xl bg-neutral-900"
        style={aspect ? undefined : { aspectRatio: '16 / 9' }}
      >
        {preview && (
          <video
            src={preview}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            onLoadedMetadata={(e) => {
              const { videoWidth, videoHeight } = e.currentTarget;
              if (videoWidth > 0 && videoHeight > 0) setAspect(videoWidth / videoHeight);
            }}
            className="pending-video-preview block h-full max-h-(--card-size) w-full object-cover opacity-50"
          />
        )}
        <div className="pending-video-status absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-white">
          {failed ? (
            <>
              <span role="alert" className="text-sm font-medium">
                {UPLOAD_TEXT.failed(file.name)}
                {error && <span className="block text-xs font-normal opacity-90">{error}</span>}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={onRetry}
                aria-label={`${UPLOAD_TEXT.retry} ${file.name}`}
              >
                {UPLOAD_TEXT.retry}
              </Button>
            </>
          ) : (
            <>
              <CircularProgress
                value={percent}
                indeterminate={processing}
                srLabel={
                  processing
                    ? `${UPLOAD_TEXT.uploading(file.name)}: ${UPLOAD_TEXT.processing}`
                    : UPLOAD_TEXT.uploading(file.name)
                }
                valueText={status}
              />
              <span className="text-sm font-medium" aria-hidden="true">
                {status}
              </span>
            </>
          )}
        </div>
        <span
          className="pending-video-caption pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-10 pb-2.5 text-start text-sm font-medium text-white"
          aria-hidden="true"
        >
          {file.name}
        </span>
      </div>
      {!processing && (
        <Button
          variant="secondary"
          size="icon"
          onClick={onRemove}
          aria-label={failed ? UPLOAD_TEXT.remove(file.name) : UPLOAD_TEXT.cancel(file.name)}
          className="pending-video-remove absolute -end-2 -top-2 z-10 h-7 w-7 rounded-full shadow"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </Button>
      )}
    </div>
  );
}
