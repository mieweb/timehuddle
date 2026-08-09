/**
 * Live-collaboration config for the huddle composer (Milestone 8).
 *
 * Builds the {@link CollabConfig} the RichEditor needs to join a `/yjs` room for
 * a given post. The websocket relay lives on the Meteor backend (not the Vite
 * origin), so we point at {@link METEOR_BASE_URL}. Auth reuses the same Meteor
 * resume token the DDP client uses (see `src/lib/ddp.ts`), passed as a query
 * param so the backend can authorize the socket.
 *
 * Returns `undefined` when there's no auth token — collaboration then simply
 * stays off and the editor behaves as a normal single-user editor.
 */
import { METEOR_BASE_URL } from '@lib/api';
import type { CollabConfig } from '@mieweb/ui/kerebron';
import { Capacitor } from '@capacitor/core';

export function huddlePostCollab(room: string | undefined): CollabConfig | undefined {
  if (!room) return undefined;
  // On native (Capacitor), the Yjs `/yjs` WebSocket is slow/unreliable over the
  // LAN, and y-prosemirror re-seeds the doc from the room on join — so the
  // editor gets cleared before the server state arrives, wiping the post's
  // existing text when editing. Collab is a real-time nicety, not required to
  // save (updatePost persists the editor's text directly), so disable it on
  // native and use the reliable single-user editor that seeds from `value`.
  if (Capacitor.isNativePlatform()) return undefined;
  const token = localStorage.getItem('meteor_resume_token');
  if (!token) return undefined;
  const wsUrl = METEOR_BASE_URL.replace(/^http/, 'ws') + '/yjs';
  return { room, wsUrl, params: { token } };
}
