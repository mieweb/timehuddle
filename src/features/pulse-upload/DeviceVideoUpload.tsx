/**
 * The "Upload from this device" fallback beside a Pulse link: picks an MP4 and
 * sends it through the same link with tus, so it lands exactly as a Pulse
 * recording would, and {@link usePulseUpload} reports where it went. Here only
 * while picking a video file is still allowed; Pulse is becoming the only way in.
 */
import { Text } from '@mieweb/ui';
import * as tus from 'tus-js-client';
import React, { useState, type RefObject } from 'react';

import { videoApi } from '../../lib/api';
import type { PulseUpload } from './usePulseUpload';

interface DeviceVideoUploadProps {
  pulse: PulseUpload;
  /** The hidden file input, for the host to open from the modal. */
  inputRef: RefObject<HTMLInputElement | null>;
}

export const DeviceVideoUpload: React.FC<DeviceVideoUploadProps> = ({ pulse, inputRef }) => {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !pulse.link) return;
    const { videoid, uploadToken } = pulse.link;

    setError(null);
    setProgress(0);
    new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: videoApi.uploadRetryDelays,
      onShouldRetry: videoApi.shouldRetryUpload,
      metadata: { filename: file.name, filetype: file.type, videoid },
      headers: { Authorization: `Bearer ${uploadToken}` },
      onProgress(bytesUploaded, bytesTotal) {
        setProgress(Math.round((bytesUploaded / bytesTotal) * 100));
      },
      // The last byte is in; the link's status says when it has landed.
      onSuccess: () => setProgress(null),
      onError(err) {
        setError(err instanceof Error ? err.message : 'Upload failed. Try again.');
        setProgress(null);
      },
    }).start();
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,video/mp4"
        className="hidden"
        aria-label="Select MP4 file to upload"
        onChange={handleFileChange}
        disabled={progress !== null}
      />
      {progress !== null && (
        <div
          className="device-video-progress h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Upload progress: ${progress}%`}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {error && (
        <Text size="xs" className="text-destructive" role="alert">
          {error}
        </Text>
      )}
    </>
  );
};
