/**
 * Live-collaboration config for the huddle composer (Milestone 8).
 *
 * **Currently switched off — see {@link COLLAB_ENABLED}.**
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

/**
 * Whether to offer live co-editing at all. **On.**
 *
 * It was off because asking for it could cost the user their editor entirely:
 * RichEditor builds its collaborative kit behind a dynamic `import()` (Yjs is
 * an optional peer, so plain mode never loads it), and when that import failed
 * the component caught the error and rendered *nothing* — an empty bordered box
 * where a post was being edited, with no callback or ready state for the host
 * to even detect it.
 *
 * Our fork of @mieweb/ui now falls back to a plain local editor in that case and
 * reports it through {@link CollabConfig.onUnavailable}, so the worst outcome is
 * an editor without live cursors rather than no editor. See
 * `vendor/ui/src/components/RichEditor/editorKits.ts`.
 */
const COLLAB_ENABLED = true;

/** Who this editor is, for the named cursor peers see. */
export interface CollabUser {
  id: string;
  name: string;
}

export function huddlePostCollab(
  room: string | undefined,
  user?: CollabUser,
): CollabConfig | undefined {
  if (!COLLAB_ENABLED) return undefined;
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
  return {
    room,
    wsUrl,
    params: { token },
    // Without a user the remote-cursor plugin skips this peer's awareness state
    // entirely, so co-editors see edits appear with no cursor and no name.
    user,
    // Collaboration is a nicety; the editor is not. The fork degrades to a
    // local editor on its own — this only records why, so a relay that is down
    // shows up in the console rather than as "the cursors stopped working".
    onUnavailable: (reason) =>
      console.warn('[huddle] live co-editing unavailable; editing locally:', reason),
  };
}
