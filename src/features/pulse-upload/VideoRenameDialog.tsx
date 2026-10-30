/**
 * VideoRenameDialog — rename one of your own videos. A video has one name (on
 * its media item), so the new one shows everywhere the video appears: its
 * ticket's or clock session's Videos, a timesheet walkthrough.
 * Empty clears it, and the video is called by its id again.
 */
import { Button, Input, ModalBody, ModalFooter, ModalHeader, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { videoApi } from '@lib/api';
import { AppModal } from '@ui/AppModal';

/** Longest name the server keeps (VIDEO_NAME_MAX in meteor-backend/server/video-names.js). */
export const VIDEO_NAME_MAX = 120;

interface VideoRenameDialogProps {
  /** The video's PulseVault id; null keeps the dialog closed. */
  videoId: string | null;
  /** Its name now. */
  name: string | null;
  onClose: () => void;
  /** After a save, with the name as the server kept it (null: none). */
  onRenamed: (name: string | null) => void;
}

export const VideoRenameDialog: React.FC<VideoRenameDialogProps> = ({
  videoId,
  name,
  onClose,
  onRenamed,
}) => {
  const [value, setValue] = useState(name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each opening starts from the video's current name.
  useEffect(() => {
    setValue(name ?? '');
    setError(null);
  }, [videoId, name]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!videoId) return;
    setSaving(true);
    setError(null);
    try {
      onRenamed(await videoApi.rename(videoId, value));
      onClose();
    } catch {
      setError("The name wasn't saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // Into <body>: the library Modal is `fixed` where it's rendered, and a
  // card inside a transformed host (a Huddle message animates in) would make
  // the backdrop and dialog cover that host instead of the screen.
  return createPortal(
    <AppModal
      open={videoId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      aria-labelledby="video-rename-title"
    >
      <form className="video-rename-form" onSubmit={save}>
        <ModalHeader>
          <Text weight="semibold" id="video-rename-title">
            Rename video
          </Text>
        </ModalHeader>
        <ModalBody className="space-y-2">
          <Input
            label="Name"
            value={value}
            maxLength={VIDEO_NAME_MAX}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            helperText="Shown wherever this video appears."
          />
          {error && (
            <Text size="sm" className="text-red-600 dark:text-red-400" role="alert">
              {error}
            </Text>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="submit" variant="primary" isLoading={saving}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </ModalFooter>
      </form>
    </AppModal>,
    document.body,
  );
};
