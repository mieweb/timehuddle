/**
 * Rename an unsent video (its ⋯ menu): the name Pulse shows and sends with
 * the video. Enter or Save keeps it; Escape or Cancel leaves it.
 */
import {
  Button,
  ButtonGroup,
  Input,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@mieweb/ui';
import { useEffect, useId, useState } from 'react';

import { AppModal } from '../../ui/AppModal';
import { MEDIA_TEXT } from './mediaStrings';

const T = MEDIA_TEXT.rename;

/** Longest name Pulse keeps for a draft (the server's VIDEO_NAME_MAX is the same). */
export const DRAFT_NAME_MAX = 120;

export interface RenameDialogProps {
  open: boolean;
  name: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

export function RenameDialog({ open, name, onSave, onClose }: RenameDialogProps) {
  const titleId = useId();
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (open) setDraft(name);
  }, [open, name]);
  const next = draft.trim();

  return (
    <AppModal
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      aria-labelledby={titleId}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (next && next !== name) onSave(next);
          else onClose();
        }}
      >
        <ModalHeader>
          <ModalTitle id={titleId}>{T.title}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Input
            label={T.label}
            value={draft}
            maxLength={DRAFT_NAME_MAX}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
        </ModalBody>
        <ModalFooter>
          <ButtonGroup>
            <Button type="button" variant="ghost" onClick={onClose}>
              {T.cancel}
            </Button>
            <Button type="submit" variant="primary">
              {T.save}
            </Button>
          </ButtonGroup>
        </ModalFooter>
      </form>
    </AppModal>
  );
}
