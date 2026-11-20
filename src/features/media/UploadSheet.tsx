/**
 * A row's sheet on the Unsent videos section (PLAN §5.2): what is happening
 * to the video, its progress while it sends, why it didn't send (in
 * pulseErrors.ts's words), and the buttons its state allows (rowActions.ts):
 * Cancel sending, Edit video, Resume, Retry or Trim, Move to…, Open,
 * Dismiss, Delete. A clock video says which clock action it belongs to.
 *
 * Presentational: the page passes the row and runs the actions.
 */
import {
  Alert,
  Button,
  ButtonGroup,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Progress,
  Text,
} from '@mieweb/ui';
import { useId } from 'react';

import { AppModal } from '../../ui/AppModal';
import { rowChip } from '../pulse-embed/chips';
import type { PulseRow } from '../pulse-embed/mergeRows';
import { PulseChip } from '../pulse-embed/OnThisPhoneRows';
import { pulseErrorCopy } from '../pulse-embed/pulseErrors';
import { MEDIA_TEXT } from './mediaStrings';
import { sheetActions, type RowFacts, type RowState, type SheetAction } from './rowActions';

const T = MEDIA_TEXT;

/** Each action's button: its label and how it looks. */
const BUTTON: Record<SheetAction, { label: string; variant: 'primary' | 'secondary' | 'danger' }> =
  {
    retry: { label: T.action.retry, variant: 'primary' },
    trim: { label: T.action.trim, variant: 'primary' },
    resume: { label: T.action.resume, variant: 'primary' },
    cancel: { label: T.action.cancel, variant: 'secondary' },
    edit: { label: T.action.edit, variant: 'secondary' },
    move: { label: T.action.move, variant: 'secondary' },
    open: { label: T.action.open, variant: 'secondary' },
    dismiss: { label: T.action.dismiss, variant: 'secondary' },
    delete: { label: T.action.delete, variant: 'danger' },
  };

/** What the sheet says about a state. */
function describe(state: RowState, headless: boolean, reason: string | null): string | null {
  switch (state) {
    case 'preparing':
      return T.sheet.preparing;
    case 'queued':
      return T.sheet.queued;
    case 'waiting_network':
      return T.sheet.waitingNetwork;
    case 'uploading':
      return T.sheet.uploading;
    case 'delivering':
      return T.sheet.delivering;
    case 'needs_credentials':
      return headless ? T.sheet.pausedAuto : T.sheet.pausedTap;
    case 'failed':
      return T.sheet.failed;
    case 'kept':
      return T.sheet.kept(reason);
    default:
      return null;
  }
}

export interface UploadSheetProps {
  /** The row whose sheet is open; null: closed. */
  row: PulseRow | null;
  facts: RowFacts | null;
  /** PulseKit resumes paused uploads by itself. */
  headless?: boolean;
  /** A clock video's "Belongs to your 17:02 clock-out", when it is one. */
  clockNote?: string | null;
  onAction: (action: SheetAction) => void;
  onClose: () => void;
}

export function UploadSheet({
  row,
  facts,
  headless = false,
  clockNote = null,
  onAction,
  onClose,
}: UploadSheetProps) {
  const titleId = useId();
  const open = row !== null && facts !== null;
  const name = row?.name || T.row.untitled;
  const chip = row ? rowChip(row, { headless }) : null;
  const actions = facts ? sheetActions(facts) : [];
  const state = facts?.state ?? 'draft';
  const progress = row?.local?.upload?.progress;
  const error = state === 'failed' ? (row?.local?.upload?.error ?? null) : null;
  const reason = row?.local?.sent?.reason ?? row?.server?.reason ?? null;
  const text = describe(state, headless, reason);

  return (
    <AppModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      aria-labelledby={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId} className="upload-sheet-title truncate">
          {name}
        </ModalTitle>
      </ModalHeader>
      <ModalBody className="upload-sheet flex flex-col gap-3">
        {chip && (
          <div>
            <PulseChip chip={chip} />
          </div>
        )}
        {(state === 'preparing' || state === 'uploading' || state === 'delivering') && (
          <Progress
            className="upload-sheet-progress"
            srLabel={T.sheet.progress(name)}
            value={typeof progress === 'number' ? Math.round(progress * 100) : 0}
            indeterminate={state !== 'uploading' || typeof progress !== 'number'}
          />
        )}
        {text && <Text size="sm">{text}</Text>}
        {error && (
          <Alert variant="danger" className="upload-sheet-error">
            {pulseErrorCopy(error).copy}
          </Alert>
        )}
        {clockNote && (
          <Text size="sm" variant="muted" className="upload-sheet-clock">
            {clockNote}
          </Text>
        )}
      </ModalBody>
      <ModalFooter>
        <ButtonGroup className="w-full">
          {actions.map((action) => (
            <Button
              key={action}
              variant={BUTTON[action].variant}
              onClick={() => onAction(action)}
              data-action={action}
            >
              {BUTTON[action].label}
            </Button>
          ))}
          <Button variant="ghost" onClick={onClose}>
            {T.action.close}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </AppModal>
  );
}
