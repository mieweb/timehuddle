/**
 * A video on its way up, drawn like the card it becomes (PulseVideoPlayer):
 * the file's own first frame, dimmed, with how far it has got — then
 * Processing while the server makes it ready to play — and a cancel × while
 * its bytes are still going up.
 */
import { Button, CircularProgress } from '@mieweb/ui';
import { useEffect, useState } from 'react';
import { VIDEO_CARD_SIZE, cardBox } from './PulseVideoPlayer';

/** User-facing text, kept in one place for translation. */
export const PENDING_VIDEO_TEXT = {
  uploading: (name: string) => `Uploading ${name}`,
  percent: (percent: number) => `${percent}%`,
  processing: 'Processing…',
  cancel: (name: string) => `Cancel upload of ${name}`,
};

interface PendingVideoCardProps {
  file: File;
  /** Sent fraction, 0–1. */
  progress: number;
  /** Every byte is in and the server is converting it. */
  processing: boolean;
  /** Stops the upload; omitted once there's nothing left to cancel. */
  onCancel?: () => void;
  /** The card's box, as PulseVideoPlayer's. @default VIDEO_CARD_SIZE */
  maxSize?: string;
}

/** An object URL for `file` while it's shown, revoked after. */
function useObjectUrl(file: File): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function PendingVideoCard({
  file,
  progress,
  processing,
  onCancel,
  maxSize = VIDEO_CARD_SIZE,
}: PendingVideoCardProps) {
  const preview = useObjectUrl(file);
  // The shape, from the file itself, as the real card learns it from its poster.
  const [aspect, setAspect] = useState<number | null>(null);
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const status = processing ? PENDING_VIDEO_TEXT.processing : PENDING_VIDEO_TEXT.percent(percent);

  return (
    // The cancel × sits over the corner, outside the clipped frame.
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
        <div className="pending-video-status absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
          <CircularProgress
            value={percent}
            indeterminate={processing}
            srLabel={PENDING_VIDEO_TEXT.uploading(file.name)}
            valueText={status}
          />
          <span className="text-sm font-medium" aria-hidden="true">
            {status}
          </span>
        </div>
        <span
          className="pending-video-caption pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-10 pb-2.5 text-start text-sm font-medium text-white"
          aria-hidden="true"
        >
          {file.name}
        </span>
      </div>
      {onCancel && (
        <Button
          variant="secondary"
          size="icon"
          onClick={onCancel}
          aria-label={PENDING_VIDEO_TEXT.cancel(file.name)}
          className="pending-video-cancel absolute -end-2 -top-2 z-10 h-7 w-7 rounded-full shadow"
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
