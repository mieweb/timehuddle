/**
 * A tap outside any field closes the phone's keyboard. iOS keeps a field
 * focused (and its keyboard up) when the tap lands on something that can't
 * take focus, such as a dialog's blank space or a label; this blurs it. Use as
 * an `onPointerDown` on the area, e.g. a dialog's body.
 */
import type React from 'react';

const FIELD = 'input, textarea, select, [contenteditable="true"]';

export function blurOnTapAway(event: React.PointerEvent) {
  if ((event.target as Element).closest(FIELD)) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(FIELD)) active.blur();
}
