/**
 * ComposerProgress — one full-width bar covering every phase of composing a
 * post, shared by the Huddle composer and the Clock page's plan/wrap-up
 * composer so both read identically.
 *
 * Uploads report real byte progress, so the bar is determinate there. Posting
 * has no byte stream to measure, so it eases toward 83% (see the
 * `huddle-progress` keyframes in styles.css) and snaps to 100% when the post
 * resolves — honest about being an estimate while still moving.
 */
interface ComposerProgressProps {
  /** 0–1 while an attachment is uploading, null otherwise. */
  uploadFraction: number | null;
  /** A post/publish request is in flight. */
  posting: boolean;
  /** That request has resolved — snap the bar to 100% before it disappears. */
  postDone?: boolean;
}

export function ComposerProgress({
  uploadFraction,
  posting,
  postDone = false,
}: ComposerProgressProps) {
  const uploading = uploadFraction !== null;
  if (!uploading && !posting) return null;

  const percent = uploading ? Math.round(uploadFraction * 100) : postDone ? 100 : undefined;

  return (
    <div
      data-testid="post-progress-bar"
      role="progressbar"
      aria-label={uploading ? 'Uploading attachment' : 'Publishing post'}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent !== undefined ? { 'aria-valuenow': percent } : {})}
      className="h-0.5 w-full bg-gray-100 dark:bg-neutral-700 mt-1.5 rounded overflow-hidden"
    >
      <div
        className="h-full bg-indigo-500"
        style={
          uploading
            ? { width: `${percent}%`, transition: 'width 0.2s linear' }
            : postDone
              ? { width: '100%', transition: 'width 0.3s ease' }
              : { animation: 'huddle-progress 3s ease-out forwards' }
        }
      />
    </div>
  );
}
