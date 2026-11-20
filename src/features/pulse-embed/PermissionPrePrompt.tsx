/**
 * The in-context explanation before Pulse first records on this phone (PLAN
 * §5.3 Permissions): what Pulse is for here (tickets and clock sessions), and
 * that the phone asks for the camera and the microphone next. Continue opens
 * Pulse, which then asks the system; Not now opens nothing. Shown once per
 * phone: once someone has continued, every later tap records at once. Pulse
 * itself owns what happens after the system prompt ("Record without sound?").
 */
import {
  Button,
  ButtonGroup,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { RECORD_TEXT } from './recordStrings';

const T = RECORD_TEXT.prePrompt;

/** Where this phone remembers that the explanation was read (per device, like the OS prompt). */
export const PRE_PROMPT_SEEN_KEY = 'timehuddle.pulse.prePromptSeen';

/** Read once storage fails (a private window): the explanation still shows only once per page. */
let seenThisPage = false;

/** Whether this phone has continued past the explanation before. */
export function prePromptSeen(): boolean {
  if (seenThisPage) return true;
  try {
    return globalThis.localStorage?.getItem(PRE_PROMPT_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the explanation was read and continued past. */
export function markPrePromptSeen(): void {
  seenThisPage = true;
  try {
    globalThis.localStorage?.setItem(PRE_PROMPT_SEEN_KEY, '1');
  } catch {
    /* kept for this page only */
  }
}

/** Tests only: forget the in-page flag (storage is the test's to clear). */
export function resetPrePromptForTests(): void {
  seenThisPage = false;
}

export interface PermissionPrePromptProps {
  open: boolean;
  onContinue: () => void;
  onNotNow: () => void;
}

export function PermissionPrePrompt({ open, onContinue, onNotNow }: PermissionPrePromptProps) {
  if (typeof document === 'undefined') return null;
  // On the body: a record button sits inside a ticket row or a card, whose
  // own layers would otherwise show over the dialog.
  return createPortal(
    <AppModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onNotNow();
      }}
      size="sm"
      aria-labelledby="pulse-pre-prompt-title"
    >
      <ModalHeader>
        <ModalTitle id="pulse-pre-prompt-title">{T.title}</ModalTitle>
      </ModalHeader>
      <ModalBody className="pulse-pre-prompt flex flex-col gap-2">
        <Text>{T.body}</Text>
        <Text size="sm" variant="muted">
          {T.detail}
        </Text>
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>
          <Button type="button" variant="ghost" onClick={onNotNow}>
            {T.notNow}
          </Button>
          <Button type="button" variant="primary" onClick={onContinue}>
            {T.continue}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </AppModal>,
    document.body,
  );
}

export interface PrePromptGate {
  /** Runs `record` now when the explanation was read before; otherwise shows it first. */
  beforeRecord: (record: () => void) => void;
  /** The dialog, to render beside the button. */
  prompt: React.ReactNode;
}

/** The explanation in front of a record button's first tap on this phone. */
export function usePermissionPrePrompt(): PrePromptGate {
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const beforeRecord = useCallback((record: () => void) => {
    if (prePromptSeen()) {
      record();
      return;
    }
    pending.current = record;
    setOpen(true);
  }, []);

  const onContinue = useCallback(() => {
    markPrePromptSeen();
    setOpen(false);
    const record = pending.current;
    pending.current = null;
    record?.();
  }, []);

  const onNotNow = useCallback(() => {
    pending.current = null;
    setOpen(false);
  }, []);

  return {
    beforeRecord,
    prompt: <PermissionPrePrompt open={open} onContinue={onContinue} onNotNow={onNotNow} />,
  };
}
