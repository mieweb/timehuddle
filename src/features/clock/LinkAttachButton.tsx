/**
 * LinkAttachButton — the "Link" chip beside "Pulse" in ticket and clock-session
 * attachments (AttachmentsPanel), so the two ways in look and behave alike: a
 * chip that opens a modal. Posts don't use it — a link goes in the post text.
 *
 * Pulse records or uploads a video with the Pulse app; Link takes a pasted URL
 * — a YouTube Short, a Loom, any page. The modal mirrors the Pulse modal's
 * layout (icon title, one line of guidance, Close + primary action).
 */
import { faLink, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Input,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import { getYouTubeTitleFromUrl, isYouTubeUrl } from '@timehuddle/youtube';
import React, { useState } from 'react';

import { ComposerChipButton } from '../huddle/ComposerChipButton';
import { normalizeLink, type AddedLink } from './linkAttach';

interface LinkAttachButtonProps {
  onAdd: (link: AddedLink) => void | Promise<void>;
  disabled?: boolean;
}

export const LinkAttachButton: React.FC<LinkAttachButtonProps> = ({ onAdd, disabled }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const close = () => {
    setOpen(false);
    setValue('');
    setError(null);
  };

  const handleAdd = async () => {
    const url = normalizeLink(value);
    if (!url) {
      setError('Paste a full link, like https://youtube.com/shorts/…');
      return;
    }
    setAdding(true);
    try {
      const title = isYouTubeUrl(url) ? await getYouTubeTitleFromUrl(url).catch(() => null) : null;
      await onAdd({ url, title });
      close();
    } catch {
      setError('Could not add that link. Try again.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <ComposerChipButton
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Add a link, like a YouTube Short"
        leftIcon={<FontAwesomeIcon icon={faLink} className="w-3.5 h-3.5" aria-hidden="true" />}
      >
        Link
      </ComposerChipButton>

      <AppModal open={open} onOpenChange={(next) => !next && close()} aria-label="Add a link">
        <ModalHeader>
          <ModalTitle>
            <span className="flex items-center gap-2">
              <FontAwesomeIcon icon={faLink} aria-hidden="true" />
              Add a Link
            </span>
          </ModalTitle>
          <ModalClose />
        </ModalHeader>

        <ModalBody>
          <div className="link-attach-modal-body flex flex-col gap-3 py-2">
            <Input
              label="Link"
              type="url"
              value={value}
              autoFocus
              placeholder="https://youtube.com/shorts/…"
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAdd();
                }
              }}
            />
            <Text size="sm" className="text-muted-foreground">
              Paste a YouTube Short, a Loom, or any other link. To record or send a video of your
              own, use <strong className="text-foreground">Pulse</strong>.
            </Text>
            {error && (
              <Text size="xs" className="text-destructive" role="alert">
                {error}
              </Text>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button size="sm" variant="ghost" onClick={close}>
            <FontAwesomeIcon icon={faXmark} className="mr-1.5" aria-hidden="true" />
            Close
          </Button>
          <Button size="sm" onClick={handleAdd} isLoading={adding} disabled={!value.trim()}>
            Add link
          </Button>
        </ModalFooter>
      </AppModal>
    </>
  );
};
