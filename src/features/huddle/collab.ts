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
 * Whether to offer live co-editing at all. **Off**, because asking for it can
 * cost the user their editor entirely.
 *
 * RichEditor builds its collaborative kit behind a dynamic `import()` (Yjs is
 * an optional peer, so plain mode never loads it). When that import fails,
 * RichEditor catches the error and renders *nothing*: the edit composer becomes
 * an empty bordered box — no toolbar, no post text, nothing to type into — and
 * the post can't be edited at all. New posts are unaffected, because they never
 * pass `collab` and so never load that chunk.
 *
 * The component gives the host no way to notice: there is no error callback or
 * ready state on its props, so an app can only guess from the DOM after some
 * arbitrary delay. Rather than ship that guess, we stop asking for the feature
 * until the component handles its own failure — mieweb/ui#480 adds exactly
 * that, falling back to a local editor and reporting it through a new
 * `collab.onUnavailable`.
 *
 * **To restore live editing:** upgrade `@mieweb/ui` past that fix, flip this to
 * `true`, and un-skip `tests/e2e/huddle/yjs-collab-editing.spec.ts`. Nothing
 * else changed — the relay (`meteor-backend/server/yjs.js`), the rooms and the
 * `collabRoom` wiring are all untouched, so it is a one-line switch back.
 */
const COLLAB_ENABLED = false;

export function huddlePostCollab(room: string | undefined): CollabConfig | undefined {
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
  return { room, wsUrl, params: { token } };
}
