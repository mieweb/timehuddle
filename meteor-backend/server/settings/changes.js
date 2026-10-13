/**
 * In-process signal that some team, org or enterprise setting changed, so every
 * live team subscription on this server can republish its resolved settings.
 * Instances do not hear each other: a subscriber on another instance catches up
 * on its next team change or resubscribe.
 */
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function onSettingsChanged(listener) {
  emitter.on('changed', listener);
  return () => emitter.off('changed', listener);
}

export function announceSettingsChanged() {
  emitter.emit('changed');
}
