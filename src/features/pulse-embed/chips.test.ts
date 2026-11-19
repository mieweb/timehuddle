import type { DraftState, DraftSummary } from '@mieweb/pulse-embed';
import { describe, expect, it } from 'vitest';

import type { PulseUploadPublic, PulseUploadState } from '../../lib/api';
import { attentionCount, draftChip, rowChip, serverChip } from './chips';

const draft = (state: DraftState, extra: Partial<DraftSummary> = {}): DraftSummary => ({
  id: 'd1',
  draftKey: 'inst:d1',
  name: 'Fix login',
  context: null,
  state,
  clipCount: 1,
  durationMs: 42_000,
  hasCaptions: false,
  poster: null,
  createdVia: 'host',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const server = (state: PulseUploadState, extra: Partial<PulseUploadPublic> = {}) =>
  ({
    id: 'u1',
    userId: 'me',
    type: 'ticket.video',
    targetKey: 'ticket:abc',
    state,
    name: 'Fix login',
    durationMs: 42_000,
    sentAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:01.000Z',
    reason: null,
    note: null,
    attachmentId: null,
    mediaId: null,
    ...extra,
  }) satisfies PulseUploadPublic;

const upload = (extra: Partial<NonNullable<DraftSummary['upload']>> = {}) => ({
  clientKey: 'inst:d1:0123456789abcdef',
  attempts: 1,
  sentAt: 5,
  ...extra,
});

describe('draftChip (§5.2 table)', () => {
  it.each<[DraftState, string, boolean]>([
    ['draft', 'Draft', false],
    ['ready', 'Ready to send', false],
    ['preparing', 'Preparing…', false],
    ['queued', 'Waiting to send', false],
    ['waiting_network', 'Waiting for network', false],
    ['delivering', 'Processing…', false],
    ['failed', "Didn't send", true],
  ])('%s reads "%s" (attention: %s)', (state, text, attention) => {
    const c = draftChip(draft(state));
    expect(c.text).toBe(text);
    expect(c.attention).toBe(attention);
    expect(c.icon).toBeTruthy();
  });

  it('says how far an upload has got, and the same state at any percent', () => {
    const early = draftChip(draft('uploading', { upload: upload({ progress: 0.371 }) }));
    const later = draftChip(draft('uploading', { upload: upload({ progress: 0.9 }) }));
    expect(early.text).toBe('Uploading 37%');
    expect(later.text).toBe('Uploading 90%');
    expect(early.state).toBe(later.state);
    expect(draftChip(draft('uploading', { upload: upload() })).text).toBe('Uploading');
  });

  it('tells a paused upload apart by whether Pulse can resume it alone', () => {
    expect(draftChip(draft('needs_credentials'), { headless: true }).text).toBe(
      'Paused · resumes automatically',
    );
    expect(draftChip(draft('needs_credentials'), { headless: false }).text).toBe(
      'Paused · Tap to resume',
    );
  });

  it('says Trim for a video too large to send', () => {
    const c = draftChip(
      draft('failed', {
        upload: upload({
          error: { code: 'upload.too_large', message: 'over', recoverable: false, callId: 'c' },
        }),
      }),
    );
    expect(c.text).toBe('Too large to send · Trim');
    expect(c.attention).toBe(true);
  });

  it('reads receipts: attached, and kept until dismissed', () => {
    const receipt = {
      uploadId: 'u1',
      artifactId: 'a1',
      sentAt: 5,
      at: 6,
      expiresAt: 7,
    };
    expect(
      draftChip(draft('sent', { sent: { ...receipt, outcome: 'done', dismissed: false } })),
    ).toMatchObject({ text: 'Attached ✓', attention: false });
    const kept = draftChip(
      draft('sent', {
        sent: { ...receipt, outcome: 'kept', reason: 'ticket was deleted', dismissed: false },
      }),
    );
    expect(kept).toMatchObject({
      text: 'Saved to your library (ticket was deleted)',
      attention: true,
    });
    expect(
      draftChip(draft('sent', { sent: { ...receipt, outcome: 'kept', dismissed: true } }))
        .attention,
    ).toBe(false);
  });

  it('reads a state a newer Pulse adds as a draft', () => {
    expect(draftChip(draft('archived' as DraftState)).text).toBe('Draft');
  });

  it('never leans on colour alone: every chip has text and an icon', () => {
    const states: DraftState[] = [
      'draft',
      'ready',
      'preparing',
      'queued',
      'waiting_network',
      'uploading',
      'delivering',
      'needs_credentials',
      'failed',
    ];
    for (const s of states) {
      const c = draftChip(draft(s));
      expect(c.text.trim()).not.toBe('');
      expect(c.icon).toBeTruthy();
    }
  });
});

describe('serverChip', () => {
  it('shows a viewer elsewhere that a video is on its way, then landed', () => {
    expect(serverChip(server('uploading')).text).toBe('Uploading from iPhone…');
    expect(serverChip(server('reserved')).text).toBe('Uploading from iPhone…');
    expect(serverChip(server('processing')).text).toBe('Processing…');
    expect(serverChip(server('delivered')).text).toBe('Attached ✓');
    expect(serverChip(server('kept', { reason: 'ticket was deleted.' }))).toMatchObject({
      text: 'Saved to your library (ticket was deleted)',
      attention: true,
    });
  });
});

describe('rowChip', () => {
  it('takes the server outcome over what the phone still says', () => {
    const local = draft('delivering', { upload: upload() });
    expect(rowChip({ local, server: server('processing') }).text).toBe('Processing…');
    expect(rowChip({ local, server: server('delivered') }).text).toBe('Attached ✓');
  });

  it('keeps the phone state while the server row is still on its way', () => {
    const local = draft('uploading', { upload: upload({ progress: 0.5 }) });
    expect(rowChip({ local, server: server('uploading') }).text).toBe('Uploading 50%');
  });

  it('drops attention from a kept video already dismissed on this phone', () => {
    const local = draft('sent', {
      sent: {
        outcome: 'kept',
        dismissed: true,
        uploadId: 'u1',
        artifactId: 'a1',
        sentAt: 1,
        at: 2,
        expiresAt: 3,
      },
    });
    expect(rowChip({ local, server: server('kept') }).attention).toBe(false);
  });

  it('counts the rows that need attention', () => {
    expect(
      attentionCount([
        draftChip(draft('failed')),
        draftChip(draft('ready')),
        serverChip(server('kept')),
      ]),
    ).toBe(2);
  });
});
