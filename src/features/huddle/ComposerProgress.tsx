/**
 * ComposerProgress — the Clock composer's bar while a post is being published.
 * Attachments show their own progress on their tiles (useComposerUploads), so
 * this covers only the request: there's no byte stream to measure, so it
 * eases toward 83% (see the `huddle-progress` keyframes in styles.css) and
 * snaps to 100% when the post resolves — honest about being an estimate while
 * still moving.
 */
interface ComposerProgressProps {
  /** A post/publish request is in flight. */
  posting: boolean;
  /** That request has resolved — snap the bar to 100% before it disappears. */
  postDone?: boolean;
}

export function ComposerProgress({ posting, postDone = false }: ComposerProgressProps) {
  if (!posting) return null;
  return (
    <div
      data-testid="post-progress-bar"
      role="progressbar"
      aria-label="Publishing post"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(postDone ? { 'aria-valuenow': 100 } : {})}
      className="composer-progress h-0.5 w-full bg-gray-100 dark:bg-neutral-700 mt-1.5 rounded overflow-hidden"
    >
      <div
        className="composer-progress-fill h-full bg-indigo-500"
        style={
          postDone
            ? { width: '100%', transition: 'width 0.3s ease' }
            : { animation: 'huddle-progress 3s ease-out forwards' }
        }
      />
    </div>
  );
}
