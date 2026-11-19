import type { DraftState, DraftSummary } from '@mieweb/pulse-embed';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PulseUploadPublic } from '../../lib/api';
import { mergeRows } from '../pulse-embed/mergeRows';
import { PULSE_EMBED_TEXT } from '../pulse-embed/pulseEmbedStrings';
import { createMediaActions } from './mediaActions';
import { rowFacts, sheetActions, type SheetAction } from './rowActions';
import { PLACES, draftAt } from './testRows';
import { UploadSheet } from './UploadSheet';

function spyClient() {
  return {
    upload: vi.fn(async () => ({ clientKey: 'k', draftKey: 'dk', sentAt: 1 })),
    cancelUpload: vi.fn(async () => {}),
    deleteDraft: vi.fn(async () => {}),
    renameDraft: vi.fn(async () => {}),
    setDraftContext: vi.fn(async () => {}),
    dismissReceipt: vi.fn(async () => {}),
    resumeOutbox: vi.fn(async () => {}),
  };
}

/**
 * The sheet for a draft, wired to the page's actions over a spy client:
 * Move to… picks the open session, as the Move to… sheet would.
 */
function renderSheet(draft: DraftSummary) {
  const client = spyClient();
  const open = vi.fn(async () => null);
  const reportError = vi.fn();
  const actions = createMediaActions({ client, open, reportError });
  const row = mergeRows([draft], [])[0];
  const facts = rowFacts(row);
  const onAction = vi.fn(async (action: SheetAction) => {
    if (action === 'move') await actions.move(row, PLACES.session, facts.state);
    else if (action !== 'delete') await actions.sheet(action, row, facts.state);
  });
  render(
    <UploadSheet row={row} facts={facts} onAction={(a) => void onAction(a)} onClose={vi.fn()} />,
  );
  const tap = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };
  return { client, open, reportError, tap };
}

const at = (state: DraftState, extra: Partial<DraftSummary> = {}) =>
  draftAt(PLACES.ticket, state, { id: 'd1', ...extra });

describe('UploadSheet', () => {
  afterEach(cleanup);

  it('Cancel sending cancels the job', async () => {
    const { client, tap } = renderSheet(at('queued'));
    await tap('Cancel sending');
    expect(client.cancelUpload).toHaveBeenCalledWith('d1');
  });

  it('Edit video cancels the job, then opens the editor', async () => {
    const { client, open, tap } = renderSheet(at('waiting_network'));
    await tap('Edit video');
    expect(client.cancelUpload).toHaveBeenCalledWith('d1');
    expect(open).toHaveBeenCalledWith({ entry: 'edit', draftId: 'd1' });
    expect(client.cancelUpload.mock.invocationCallOrder[0]).toBeLessThan(
      open.mock.invocationCallOrder[0],
    );
  });

  it('Resume runs the outbox again', async () => {
    const { client, tap } = renderSheet(at('needs_credentials'));
    await tap('Resume');
    expect(client.resumeOutbox).toHaveBeenCalled();
  });

  it('Retry sends again', async () => {
    const { client, tap } = renderSheet(at('failed'));
    await tap('Retry');
    expect(client.upload).toHaveBeenCalledWith('d1');
  });

  it('Move to… gives the draft its new place, then sends it', async () => {
    const { client, tap } = renderSheet(at('failed'));
    await tap('Move to…');
    expect(client.setDraftContext).toHaveBeenCalledWith('d1', PLACES.session.context);
    expect(client.upload).toHaveBeenCalledWith('d1');
    expect(client.setDraftContext.mock.invocationCallOrder[0]).toBeLessThan(
      client.upload.mock.invocationCallOrder[0],
    );
  });

  it("a kept video this phone hasn't polled yet moves with no receipt to dismiss", async () => {
    const client = spyClient();
    const reportError = vi.fn();
    const uploads = {
      retarget: vi.fn(async () => ({ state: 'delivered' as const, note: '' })),
      cancel: vi.fn(),
    };
    const actions = createMediaActions({
      client,
      open: vi.fn(),
      reportError,
      uploads: uploads as never,
    });
    const kept: PulseUploadPublic = {
      id: 'up1',
      userId: 'me',
      type: 'ticket.video',
      targetKey: PLACES.ticket.context.key,
      state: 'kept',
      name: null,
      durationMs: null,
      sentAt: null,
      updatedAt: null,
      reason: 'ticket was deleted',
      note: null,
      attachmentId: null,
      mediaId: 'm1',
      draftKey: 'inst:d1',
    };
    const row = mergeRows([at('delivering')], [kept])[0];
    const facts = rowFacts(row);
    expect(facts.state).toBe('kept');
    expect(sheetActions(facts)).not.toContain('dismiss');

    expect(await actions.move(row, PLACES.post, facts.state)).toBe(true);
    expect(uploads.retarget).toHaveBeenCalledWith({
      uploadId: 'up1',
      type: PLACES.post.type,
      target: PLACES.post.target,
    });
    expect(client.dismissReceipt).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a refused call is shown, never swallowed', async () => {
    const { client, reportError, open, tap } = renderSheet(at('queued'));
    const refused = { code: 'draft.locked' };
    client.cancelUpload.mockRejectedValueOnce(refused);
    await tap('Edit video');
    expect(reportError).toHaveBeenCalledWith(refused);
    // The editor doesn't open over a job that is still queued.
    expect(open).not.toHaveBeenCalled();
  });

  it("a failure says why in pulseErrors' words", () => {
    renderSheet(
      at('failed', {
        upload: {
          clientKey: 'k',
          attempts: 2,
          sentAt: 1,
          error: { code: 'destination.gone', message: 'gone', recoverable: false, callId: 'c' },
        },
      }),
    );
    expect(screen.getByText(PULSE_EMBED_TEXT.error.destinationGone)).toBeTruthy();
  });

  it('shows progress while uploading, with only Cancel sending', () => {
    renderSheet(
      at('uploading', { upload: { clientKey: 'k', attempts: 1, sentAt: 1, progress: 0.4 } }),
    );
    expect(screen.getByRole('progressbar', { name: 'Sending Video d1' })).toBeTruthy();
    expect(
      screen
        .getAllByRole('button')
        .map((b) => b.textContent)
        .filter((t) => t !== 'Close' && t !== ''),
    ).toEqual(['Cancel sending']);
  });

  it('a too-large video offers Trim, which opens the editor', async () => {
    const { open, tap } = renderSheet(
      at('failed', {
        upload: {
          clientKey: 'k',
          attempts: 1,
          sentAt: 1,
          error: { code: 'upload.too_large', message: '', recoverable: false, callId: 'c' },
        },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await tap('Trim');
    expect(open).toHaveBeenCalledWith({ entry: 'edit', draftId: 'd1' });
  });
});
