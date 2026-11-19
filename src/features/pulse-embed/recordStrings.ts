/**
 * Every word the "Record with Pulse" entry points say (PLAN §5.1 flows A, B1
 * and P, §5.3): the record button, the "unsent video here" link beside it,
 * and the one-time explanation before Pulse first asks for the camera and
 * microphone. The toasts after a flow are PULSE_EMBED_TEXT.flow's (the
 * provider says them). Kept in one place for translation.
 */
export const RECORD_TEXT = {
  /** The record button's name, the same everywhere (Q19). */
  record: 'Record with Pulse',
  /** Said after the button's name, so a list of them tells its rows apart. */
  forPlace: (label: string) => (label ? `For ${label}` : ''),

  // ── "1 unsent video here · Open" (O10) ──
  unsentHere: (count: number) =>
    count === 1 ? '1 unsent video here · Open' : `${count} unsent videos here · Open`,

  // ── The pre-prompt before the first recording (§5.3 Permissions) ──
  prePrompt: {
    title: 'Record with Pulse',
    body:
      'Pulse records videos for your tickets and clock sessions right here in TimeHuddle. ' +
      'Next, your phone asks to let TimeHuddle use the camera and the microphone.',
    detail: 'Videos stay on this phone until you send them.',
    continue: 'Continue',
    notNow: 'Not now',
  },
};
