/**
 * VideoRenameDialog — rename one of your own videos. A video has one name (on
 * its media item), so the new one shows everywhere the video appears: its
 * ticket's or clock session's Videos, a timesheet walkthrough.
 * Empty clears it, and the video is called by its id again.
 */
import { Button, ButtonGroup, Input, ModalBody, ModalFooter, ModalHeader, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { videoApi } from '@lib/api';
import { AppModal } from '@ui/AppModal';

/** Longest name the server keeps (VIDEO_NAME_MAX in meteor-backend/server/video-names.js). */
export const VIDEO_NAME_MAX = 120;

/** User-facing copy, kept together for translation. */
const RENAME_COPY = {
  title: 'Rename video',
  label: 'Name',
  help: 'Shown wherever this video appears.',
  failed: "The name wasn't saved. Try again.",
  save: 'Save',
  cancel: 'Cancel',
};

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
      setError(RENAME_COPY.failed);
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
            {RENAME_COPY.title}
          </Text>
        </ModalHeader>
        <ModalBody className="space-y-2">
          <Input
            label={RENAME_COPY.label}
            value={value}
            maxLength={VIDEO_NAME_MAX}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            helperText={RENAME_COPY.help}
          />
          {error && (
            <Text size="sm" className="text-red-600 dark:text-red-400" role="alert">
              {error}
            </Text>
          )}
        </ModalBody>
        <ModalFooter>
          <ButtonGroup>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {RENAME_COPY.cancel}
            </Button>
            <Button type="submit" variant="primary" isLoading={saving}>
              {RENAME_COPY.save}
            </Button>
          </ButtonGroup>
        </ModalFooter>
      </form>
    </AppModal>,
    document.body,
  );
};
