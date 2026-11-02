/**
 * VideoNameDialog — names one of your own videos, or renames it, in a dialog
 * from its ⋯ menu (on its card, beside its title in the media view, on its
 * page). A field wide enough for a long name, wrapping onto more lines rather
 * than scrolling out of sight, with a count up to the server's limit. Enter
 * or Save keeps it, Escape or Cancel leaves it. A video has one name (on its
 * media item), so the new one shows everywhere it appears. Empty removes it,
 * and the video is called by its id again.
 */
import {
  Button,
  ButtonGroup,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Textarea,
} from '@mieweb/ui';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { videoApi } from '@lib/api';
import { useEscapeWithin } from '@lib/useEscapeWithin';
import { AppModal } from '@ui/AppModal';
import { noteRenamed } from './videoNames';

/** Longest name the server keeps (VIDEO_NAME_MAX in meteor-backend/server/video-names-core.js). */
export const VIDEO_NAME_MAX = 120;

/** User-facing copy, kept together for translation. */
export const NAME_DIALOG_COPY = {
  addName: 'Add a name',
  rename: 'Rename video',
  label: 'Video name',
  placeholder: 'Sprint demo',
  hint: 'Shows wherever this video appears. Leave it empty to remove the name.',
  failed: "The name wasn't saved. Try again.",
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
};

/** A name is one line: a pasted line break becomes a space. */
const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ');

interface VideoNameDialogProps {
  /** The video's PulseVault id. */
  video: string;
  /** Its name now (null: none, so the dialog adds one). */
  name: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a save, with the name the server kept (null: none). */
  onRenamed?: (name: string | null) => void;
}

export function VideoNameDialog({
  video,
  name,
  open,
  onOpenChange,
  onRenamed,
}: VideoNameDialogProps) {
  const [draft, setDraft] = useState(name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether this opening has selected the name yet (on the field's first focus).
  const selectedRef = useRef(false);
  // Escape closes it alone, not a window or media view under it.
  const formRef = useRef<HTMLFormElement>(null);
  useEscapeWithin(formRef, () => !saving && onOpenChange(false), open);

  // Each opening starts from the name as it is, selected to type over.
  useEffect(() => {
    if (!open) return;
    setDraft(name ?? '');
    setError(null);
    selectedRef.current = false;
  }, [open, name]);

  const save = async () => {
    // Nothing changed: Save just closes.
    if (draft.trim() === (name ?? '')) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const renamed = await videoApi.rename(video, draft);
      noteRenamed(video, renamed);
      onRenamed?.(renamed);
      onOpenChange(false);
    } catch {
      setError(NAME_DIALOG_COPY.failed);
    } finally {
      setSaving(false);
    }
  };

  // On the body: the library's Modal renders where it's placed, and a video's
  // menu sits inside a card or Huddle's media view (fixed, its own layer on a
  // phone), whose controls would otherwise show over the dialog.
  return createPortal(
    <AppModal
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      size="md"
      closeOnEscape={false}
    >
      <ModalHeader>
        <ModalTitle>{name ? NAME_DIALOG_COPY.rename : NAME_DIALOG_COPY.addName}</ModalTitle>
      </ModalHeader>
      <form
        ref={formRef}
        className="video-name-dialog"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving) void save();
        }}
      >
        <ModalBody>
          <Textarea
            richText={false}
            // It grows with the name, so no drag handle.
            resize="none"
            // The dialog focuses the field as it opens; the name is selected then.
            onFocus={(event) => {
              if (selectedRef.current) return;
              selectedRef.current = true;
              event.currentTarget.select();
            }}
            label={NAME_DIALOG_COPY.label}
            placeholder={NAME_DIALOG_COPY.placeholder}
            helperText={error ? undefined : NAME_DIALOG_COPY.hint}
            error={error ?? undefined}
            maxLength={VIDEO_NAME_MAX}
            showCount
            value={draft}
            disabled={saving}
            onChange={(event) => {
              setDraft(oneLine(event.target.value));
              setError(null);
            }}
            onKeyDown={(event) => {
              // Enter keeps it (a name has no line breaks); not mid-composition.
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </ModalBody>
        <ModalFooter>
          <ButtonGroup>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {NAME_DIALOG_COPY.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? NAME_DIALOG_COPY.saving : NAME_DIALOG_COPY.save}
            </Button>
          </ButtonGroup>
        </ModalFooter>
      </form>
    </AppModal>,
    document.body,
  );
}
