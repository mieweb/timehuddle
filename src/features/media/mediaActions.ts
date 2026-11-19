/**
 * What each row action calls (PLAN §5.1 Unsent videos and Move to…, §5.2,
 * §6.1): Pulse's client for the draft, and the server for a kept video's
 * move. Every failure is shown (pulseErrors.ts copy), never swallowed: no tap
 * ends in a refused call that says nothing. The page's undo for Send and
 * Delete (§5.3) sits on top of `send`, `unsend` and `remove`.
 */
import type { OpenRequest, PulseClient } from '@mieweb/pulse-embed';

import { pulseUploadApi } from '../../lib/api';
import type { PulseRow } from '../pulse-embed/mergeRows';
import type { PulsePlace } from '../pulse-embed/place';
import { watchPath } from '../pulse-upload/artifact';
import { videoIdOf, type RowState, type SheetAction } from './rowActions';
import { isClockBound } from './unsentRows';

export type MediaClient = Pick<
  PulseClient,
  | 'upload'
  | 'cancelUpload'
  | 'deleteDraft'
  | 'renameDraft'
  | 'setDraftContext'
  | 'dismissReceipt'
  | 'resumeOutbox'
>;

export interface MediaActionDeps {
  client: MediaClient;
  /** Opens a Pulse flow (the provider's `open`, which reports its own failures). */
  open: (request: OpenRequest) => Promise<unknown>;
  /** Shows a failure (the provider's `reportError`). */
  reportError: (error: unknown) => void;
  /** The server calls a kept video's move and a clock video's delete need. */
  uploads?: Pick<typeof pulseUploadApi, 'retarget' | 'cancel'>;
  /** Goes to the video's page, which lives outside the app shell. */
  watch?: (path: string) => void;
}

/** States whose job Edit cancels before the editor opens (§5.2, §6.1). */
const EDIT_CANCELS: ReadonlySet<RowState> = new Set([
  'queued',
  'waiting_network',
  'needs_credentials',
  'failed',
]);

const draftIdOf = (row: PulseRow): string | null => row.local?.id ?? null;

export interface MediaActions {
  /** Send from the list; resolves true once it is queued. */
  send(row: PulseRow): Promise<boolean>;
  /** Undo a list Send: back to a draft while the job is still queued. */
  unsend(row: PulseRow): Promise<boolean>;
  /** Open the draft in Pulse's editor; a queued, paused or failed job is cancelled first. */
  edit(row: PulseRow, state: RowState): Promise<void>;
  /** Delete for good (the undo window has passed). */
  remove(row: PulseRow): Promise<boolean>;
  rename(row: PulseRow, name: string): Promise<boolean>;
  /** Move to…: a draft gets the new place and is sent; a kept video is retargeted on the server. */
  move(row: PulseRow, place: PulsePlace, state: RowState): Promise<boolean>;
  /** The video's page. */
  watch(row: PulseRow): void;
  /** One of the sheet's buttons (Move to… and Delete go through the page). */
  sheet(
    action: Exclude<SheetAction, 'move' | 'delete'>,
    row: PulseRow,
    state: RowState,
  ): Promise<void>;
}

export function createMediaActions(deps: MediaActionDeps): MediaActions {
  const { client, open, reportError } = deps;
  const uploads = deps.uploads ?? pulseUploadApi;
  const goWatch = deps.watch ?? ((path: string) => window.location.assign(path));

  /** Runs `call`; a failure is shown and resolves false. */
  const attempt = async (call: () => Promise<unknown>): Promise<boolean> => {
    try {
      await call();
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const withDraft = (row: PulseRow, call: (id: string) => Promise<unknown>) => {
    const id = draftIdOf(row);
    if (!id) {
      reportError({ code: 'not_found' });
      return Promise.resolve(false);
    }
    return attempt(() => call(id));
  };

  const actions: MediaActions = {
    send: (row) => withDraft(row, (id) => client.upload(id)),
    unsend: (row) => withDraft(row, (id) => client.cancelUpload(id)),

    async edit(row, state) {
      const id = draftIdOf(row);
      if (!id) return reportError({ code: 'not_found' });
      if (EDIT_CANCELS.has(state) && !(await attempt(() => client.cancelUpload(id)))) return;
      await open({ entry: 'edit', draftId: id });
    },

    remove: (row) =>
      withDraft(row, async (id) => {
        await client.deleteDraft(id);
        // A clock video's intent row would otherwise wait for a video that
        // never comes (O13): the server marks it abandoned. Best effort; the
        // draft is already gone.
        if (isClockBound(row.local) && row.server) {
          await uploads
            .cancel({ uploadId: row.server.id, reason: 'deleted' })
            .catch((error) => console.warn('[media] cancel after delete failed:', error));
        }
      }),

    rename: (row, name) => withDraft(row, (id) => client.renameDraft(id, name)),

    move: (row, place, state) =>
      withDraft(row, async (id) => {
        if (state === 'kept') {
          const uploadId = row.local?.sent?.uploadId || row.server?.id;
          if (!uploadId) throw { code: 'not_found' };
          await uploads.retarget({ uploadId, type: place.type, target: place.target });
          await client.dismissReceipt(id);
          return;
        }
        await client.setDraftContext(id, place.context);
        await client.upload(id);
      }),

    watch(row) {
      const video = videoIdOf(row);
      if (video) goWatch(watchPath(video));
    },

    async sheet(action, row, state) {
      switch (action) {
        case 'retry':
          await actions.send(row);
          return;
        case 'cancel':
          await actions.unsend(row);
          return;
        case 'edit':
        case 'trim':
          await actions.edit(row, state);
          return;
        case 'resume':
          await attempt(() => client.resumeOutbox());
          return;
        case 'dismiss':
          await withDraft(row, (id) => client.dismissReceipt(id));
          return;
        case 'open':
          actions.watch(row);
          return;
      }
    },
  };
  return actions;
}
