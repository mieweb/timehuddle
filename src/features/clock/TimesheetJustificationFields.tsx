/**
 * TimesheetJustificationFields — the description + video a retroactive
 * timesheet change has to carry on a team that reviews them.
 *
 * Rendered inside the existing edit/add/delete modals rather than as a separate
 * step, so the reviewer's evidence is gathered in the same breath as the change
 * itself. Video goes through the same PulseVault reserve + TUS upload the media
 * library and Huddle composer use, so a recording made in Pulse Cam and a file
 * picked from the device land in the same place.
 */
import { faCircleCheck, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text, Textarea } from '@mieweb/ui';
import React, { useRef, useState } from 'react';
import * as tus from 'tus-js-client';

import { videoApi } from '../../lib/api';
import { TIMESHEET_DESCRIPTION_MIN } from '../../lib/timesheetApproval';

/** PulseVault serves an uploaded recording at a stable path derived from its id. */
export function artifactUrl(videoid: string): string {
  return `/pulsevault/artifacts/${videoid}`;
}

async function uploadJustificationVideo(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const { videoid, uploadToken } = await videoApi.reserveForLibrary();

  await new Promise<void>((resolve, reject) => {
    new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: videoApi.uploadRetryDelays,
      onShouldRetry: videoApi.shouldRetryUpload,
      metadata: { videoid, filename: file.name, filetype: file.type },
      headers: { Authorization: `Bearer ${uploadToken}` },
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
      onError: reject,
    }).start();
  });

  return videoid;
}

export interface TimesheetJustificationState {
  description: string;
  videoUrl: string | null;
}

interface TimesheetJustificationFieldsProps {
  value: TimesheetJustificationState;
  onChange: (next: TimesheetJustificationState) => void;
  /** Deletes are explained in writing only — there is no new time to evidence. */
  videoRequired: boolean;
  disabled?: boolean;
  /** Surfaced so the requester knows who they are waiting on. */
  approverCount: number;
}

export const TimesheetJustificationFields: React.FC<TimesheetJustificationFieldsProps> = ({
  value,
  onChange,
  videoRequired,
  disabled,
  approverCount,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = disabled || progress !== null;
  const remaining = TIMESHEET_DESCRIPTION_MIN - value.description.trim().length;

  const handleFile = async (file: File) => {
    setError(null);
    setProgress(0);
    try {
      const videoid = await uploadJustificationVideo(file, setProgress);
      onChange({ ...value, videoUrl: artifactUrl(videoid) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Try again.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <section
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
      aria-labelledby="timesheet-justification-heading"
    >
      <Text id="timesheet-justification-heading" size="sm" weight="medium">
        Needs approval
      </Text>
      <Text variant="muted" size="xs" className="mt-0.5">
        {approverCount === 1
          ? 'An admin has to approve this before it takes effect.'
          : `One of ${approverCount} admins has to approve this before it takes effect.`}
      </Text>

      <div className="mt-3 space-y-1">
        <label htmlFor="timesheet-justification-note" className="block">
          <Text size="xs" weight="medium">
            Why is this change needed?
          </Text>
        </label>
        <Textarea
          id="timesheet-justification-note"
          rows={3}
          value={value.description}
          disabled={busy}
          placeholder="e.g. Forgot to clock out after the deploy call ran late."
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          aria-describedby="timesheet-justification-note-hint"
        />
        <Text id="timesheet-justification-note-hint" variant="muted" size="xs" aria-live="polite">
          {remaining > 0 ? `${remaining} more characters needed` : 'Looks good'}
        </Text>
      </div>

      {/* Always offered — a recording helps the reviewer whether or not this
          particular action insists on one. */}
      <div className="mt-3 space-y-1">
        <Text size="xs" weight="medium">
          Video walkthrough {videoRequired ? '' : '(optional)'}
        </Text>
        {/* Native and hidden on purpose: the visible control is the Button
            below, and `capture` — what opens the camera rather than the file
            browser on mobile — isn't exposed by the @mieweb/ui Input. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          capture="user"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleFile(file);
          }}
        />
        {value.videoUrl ? (
          <div className="flex items-center gap-2">
            <FontAwesomeIcon
              icon={faCircleCheck}
              className="text-green-600 dark:text-green-500"
              aria-hidden
            />
            <Text size="xs">Video attached</Text>
            <Button
              variant="link"
              size="sm"
              disabled={busy}
              onClick={() => onChange({ ...value, videoUrl: null })}
            >
              Remove
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            isLoading={progress !== null}
            leftIcon={<FontAwesomeIcon icon={faVideo} />}
            onClick={() => fileInputRef.current?.click()}
          >
            {progress !== null ? `Uploading ${progress}%` : 'Record or attach video'}
          </Button>
        )}
      </div>

      {error && (
        <Text size="xs" className="mt-2 text-red-600 dark:text-red-400" role="alert">
          {error}
        </Text>
      )}
    </section>
  );
};

/** Whether the gathered justification satisfies what the server will demand. */
export function isJustificationComplete(
  value: TimesheetJustificationState,
  videoRequired: boolean,
): boolean {
  if (value.description.trim().length < TIMESHEET_DESCRIPTION_MIN) return false;
  return !videoRequired || Boolean(value.videoUrl);
}

export const emptyJustification: TimesheetJustificationState = {
  description: '',
  videoUrl: null,
};
