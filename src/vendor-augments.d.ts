/**
 * Module augmentation for @mieweb/ui/kerebron.
 *
 * The `collab` prop and `CollabConfig` type were added to RichEditor in our
 * local vendor/ui branch (`feat/richeditor-collab-yjs`). That branch has not
 * been merged to the published `@mieweb/ui` package yet. CI installs the
 * published package (which lacks these types); local dev uses `file:vendor/ui`
 * (which has them natively).
 *
 * This augmentation keeps TypeScript satisfied in both environments: the
 * interface merging below adds the missing members to whatever version of
 * `@mieweb/ui/kerebron` is installed.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type React from 'react';

declare module '@mieweb/ui/kerebron' {
  /** Collaborative (Yjs) editing configuration for {@link RichEditor}. */
  export interface CollabConfig {
    /** Room id — one shared document per room (e.g. a huddle post id). */
    room: string;
    /**
     * WebSocket base URL for the Yjs relay. Defaults to
     * `<ws|wss>://<location.host>/yjs`. The room id is appended by the provider.
     */
    wsUrl?: string;
    /** Extra query params for the socket (e.g. `{ token }` for auth). */
    params?: Record<string, string>;
  }

  /** Adds the `collab` prop to the published RichEditor via interface merging. */
  export interface RichEditorProps {
    /**
     * Enable live collaborative editing (Yjs). When set, the editor connects
     * to the `/yjs` WebSocket relay and every peer in the same room co-edits
     * one shared document. Uncontrolled like `value` — remount via `key` to
     * switch rooms.
     */
    collab?: CollabConfig;
  }
}
