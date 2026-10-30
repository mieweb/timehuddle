/**
 * VideoNameEditor — one of your own videos' name, edited in place with the
 * library's InlineEdit: on a card it is the name itself (click it, or ⋯ →
 * Rename); beside the media view's title it stands in for the ⋯ menu while
 * renaming. Enter or ✓ keeps it, Escape or ✕ leaves it. A video has one name
 * (on its media item), so the new one shows everywhere it appears. Empty
 * clears it, and the video is called by its id again.
 */
import { InlineEdit, useToast } from '@mieweb/ui';
import React from 'react';
import { videoApi } from '@lib/api';
import { noteRenamed } from './videoNames';

/** Longest name the server keeps (VIDEO_NAME_MAX in meteor-backend/server/video-names-core.js). */
export const VIDEO_NAME_MAX = 120;

/** User-facing copy, kept together for translation. */
export const NAME_EDITOR_COPY = {
  label: 'Video name',
  addName: 'Add a name',
  rename: (name: string) => `Rename ${name}`,
  tooLong: `At most ${VIDEO_NAME_MAX} characters.`,
  failed: "The name wasn't saved. Try again.",
  save: 'Save',
  cancel: 'Cancel',
};

interface VideoNameEditorProps {
  /** The video's PulseVault id. */
  video: string;
  /** Its name now (null: none). */
  name: string | null;
  /** Whether the editor is open (InlineEdit's `editing`). */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** After a save, with the name the server kept (null: none). */
  onRenamed?: (name: string | null) => void;
  className?: string;
}

export function VideoNameEditor({
  video,
  name,
  editing,
  onEditingChange,
  onRenamed,
  className = '',
}: VideoNameEditorProps) {
  const toast = useToast();
  return (
    // Dark, like the video it sits on. Its keys and taps stay its own: Escape
    // doesn't also leave the media view, and a tap doesn't play the video.
    <div
      data-theme="dark"
      className={`video-name-editor ${className}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation();
      }}
    >
      <InlineEdit
        size="sm"
        label={NAME_EDITOR_COPY.label}
        value={name ?? ''}
        placeholder={NAME_EDITOR_COPY.addName}
        validate={(next) => (next.length > VIDEO_NAME_MAX ? NAME_EDITOR_COPY.tooLong : undefined)}
        editing={editing}
        onEditingChange={onEditingChange}
        labels={{
          edit: () => (name ? NAME_EDITOR_COPY.rename(name) : NAME_EDITOR_COPY.addName),
          save: NAME_EDITOR_COPY.save,
          cancel: NAME_EDITOR_COPY.cancel,
          saveFailed: NAME_EDITOR_COPY.failed,
        }}
        onSave={async (next) => {
          try {
            const renamed = await videoApi.rename(video, next);
            noteRenamed(video, renamed);
            onRenamed?.(renamed);
          } catch (error) {
            // The editor may have closed already (it saves as it closes).
            toast.error(NAME_EDITOR_COPY.failed);
            throw error;
          }
        }}
      />
    </div>
  );
}
