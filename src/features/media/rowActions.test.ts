import type { DraftState, DraftSummary } from '@mieweb/pulse-embed';
import { describe, expect, it } from 'vitest';

import type { PulseUploadPublic } from '../../lib/api';
import { mergeRows } from '../pulse-embed/mergeRows';
import { pulsePlace } from '../pulse-embed/place';
import {
  menuActions,
  rowFacts,
  rowTap,
  sheetActions,
  type MenuAction,
  type RowFacts,
  type RowTap,
  type SheetAction,
} from './rowActions';

const ticket = pulsePlace({ type: 'ticket.video', ticketId: 'a'.repeat(24), label: 'Fix login' })!;

const draft = (state: DraftState, extra: Partial<DraftSummary> = {}): DraftSummary => ({
  id: 'd1',
  draftKey: 'inst:d1',
  name: 'Fix login',
  context: ticket.context,
  state,
  clipCount: 1,
  durationMs: 1000,
  hasCaptions: false,
  poster: null,
  createdVia: 'host',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const receipt = (outcome: 'done' | 'kept', dismissed = false) => ({
  outcome,
  uploadId: 'u1',
  artifactId: 'art1',
  sentAt: 1,
  at: 2,
  expiresAt: 3,
  dismissed,
  ...(outcome === 'kept' ? { reason: 'ticket was deleted' } : {}),
});

const factsOf = (d: DraftSummary, server: PulseUploadPublic[] = []) =>
  rowFacts(mergeRows([d], server)[0]);

type Row = [string, DraftSummary, RowTap, SheetAction[], MenuAction[]];

// One row per DraftState (PLAN §5.2), the receipt split into its two outcomes.
const TABLE: Row[] = [
  ['draft', draft('draft'), 'editor', [], ['send', 'move', 'rename', 'delete']],
  ['ready', draft('ready'), 'editor', [], ['send', 'move', 'rename', 'delete']],
  ['preparing', draft('preparing'), 'sheet', [], []],
  ['queued', draft('queued'), 'sheet', ['cancel', 'edit'], ['move', 'delete']],
  ['waiting_network', draft('waiting_network'), 'sheet', ['cancel', 'edit'], ['move', 'delete']],
  ['uploading', draft('uploading'), 'sheet', ['cancel'], []],
  ['delivering', draft('delivering'), 'sheet', [], []],
  [
    'needs_credentials',
    draft('needs_credentials'),
    'sheet',
    ['resume', 'cancel', 'edit'],
    ['move', 'delete'],
  ],
  [
    'failed',
    draft('failed'),
    'sheet',
    ['retry', 'move', 'edit', 'delete'],
    ['send', 'move', 'rename', 'delete'],
  ],
  ['sent (done)', draft('sent', { sent: receipt('done') }), 'watch', [], []],
  [
    'sent (kept)',
    draft('sent', { sent: receipt('kept') }),
    'sheet',
    ['move', 'open', 'dismiss'],
    ['move'],
  ],
];

describe('rowActions: every DraftState', () => {
  it('covers every DraftState', () => {
    const all: DraftState[] = [
      'draft',
      'ready',
      'preparing',
      'queued',
      'waiting_network',
      'uploading',
      'delivering',
      'needs_credentials',
      'failed',
      'sent',
    ];
    expect(new Set(TABLE.map(([, d]) => d.state))).toEqual(new Set(all));
  });

  it.each(TABLE)('%s: tap, sheet and menu', (_name, d, tap, sheet, menu) => {
    const f = factsOf(d);
    expect(rowTap(f)).toBe(tap);
    expect(sheetActions(f)).toEqual(sheet);
    expect(menuActions(f)).toEqual(menu);
  });
});

describe('rowActions: the special cases', () => {
  it('a clock-bound draft is never offered Move to…, in any state', () => {
    for (const [, d] of TABLE) {
      const f = factsOf({ ...d, confirmedAt: 5 });
      expect(sheetActions(f)).not.toContain('move');
      expect(menuActions(f)).not.toContain('move');
    }
  });

  it('a too-large failure offers Trim instead of Retry and Send', () => {
    const f = factsOf(
      draft('failed', {
        upload: {
          clientKey: 'k',
          attempts: 1,
          sentAt: 1,
          error: { code: 'upload.too_large', message: '', recoverable: false, callId: 'c' },
        },
      }),
    );
    expect(f.tooLarge).toBe(true);
    expect(sheetActions(f)).toEqual(['trim', 'move', 'delete']);
    expect(menuActions(f)).toEqual(['move', 'rename', 'delete']);
  });

  it('a draft with no place can be moved, never sent', () => {
    const f = factsOf(draft('ready', { context: null }));
    expect(menuActions(f)).toEqual(['move', 'rename', 'delete']);
    expect(sheetActions(factsOf(draft('failed', { context: null })))).toEqual([
      'move',
      'edit',
      'delete',
    ]);
  });

  it('a dismissed kept video keeps Move to… and Open, not Dismiss', () => {
    const f = factsOf(draft('sent', { sent: receipt('kept', true) }));
    expect(f.dismissed).toBe(true);
    expect(sheetActions(f)).toEqual(['move', 'open']);
  });

  it('a sent receipt without its video has nowhere to go', () => {
    const d = draft('sent', { sent: { ...receipt('done'), artifactId: '' } });
    expect(rowTap(factsOf(d))).toBe('nothing');
  });

  it("the server's outcome wins over a phone that hasn't polled it yet", () => {
    const server: PulseUploadPublic = {
      id: 'u1',
      userId: 'me',
      type: 'ticket.video',
      targetKey: ticket.context.key,
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
    const f = factsOf(draft('delivering'), [server]);
    expect(f.state).toBe('kept');
    expect(sheetActions(f)).toEqual(['move', 'dismiss']);
  });

  it('an unknown state reads as a draft', () => {
    const f: RowFacts = factsOf(draft('later_state' as DraftState));
    expect(f.state).toBe('draft');
    expect(rowTap(f)).toBe('editor');
  });
});
