import type { CallErrorCode, FlowErrorCode, HostServiceError } from '@mieweb/pulse-embed';
import { describe, expect, it } from 'vitest';

import {
  PULSE_ERROR_ACTIONS,
  PULSE_ERRORS,
  pulseErrorCopy,
  type PulseErrorCode,
} from './pulseErrors';

// Each union of @mieweb/pulse-embed, written out as a record keyed by it: a
// code the contract adds (or drops) fails the typecheck here, so the walk
// below always covers every code there is.
const CALL_CODES: Record<CallErrorCode, true> = {
  unavailable: true,
  unsupported: true,
  'contract.unsupported': true,
  'method.unsupported': true,
  busy: true,
  invalid_options: true,
  not_found: true,
  'draft.locked': true,
  'host.unavailable': true,
  restart_required: true,
  host_misconfigured: true,
  no_account: true,
  timeout: true,
  'storage.full': true,
  'storage.newer_schema': true,
  'storage.damaged': true,
  unknown: true,
  'runtime.paused': true,
};
const FLOW_CODES: Record<FlowErrorCode, true> = {
  'permission.camera': true,
  'permission.microphone': true,
  'storage.full': true,
  'storage.newer_schema': true,
  'storage.damaged': true,
  'export.failed': true,
  'upload.failed': true,
  'upload.refused': true,
  'destination.gone': true,
  'credentials.expired': true,
  'runtime.error': true,
  unknown: true,
  'upload.too_large': true,
};
const HOST_CODES: Record<HostServiceError['code'], true> = {
  'destination.gone': true,
  'upload.refused': true,
  no_account: true,
  'host.unavailable': true,
  'upload.too_large': true,
};

const UNIONS = {
  CallErrorCode: Object.keys(CALL_CODES) as PulseErrorCode[],
  FlowErrorCode: Object.keys(FLOW_CODES) as PulseErrorCode[],
  'HostServiceError code': Object.keys(HOST_CODES) as PulseErrorCode[],
};

describe('pulseErrors', () => {
  for (const [union, codes] of Object.entries(UNIONS)) {
    describe(union, () => {
      it.each(codes)('%s has copy and an action', (code) => {
        const shown = pulseErrorCopy({ code, message: 'from Pulse' });
        expect(shown.code).toBe(code);
        expect(shown.copy.trim()).not.toBe('');
        expect(PULSE_ERROR_ACTIONS).toContain(shown.action);
        expect(shown.actionLabel.trim()).not.toBe('');
      });
    });
  }

  it('has no entry for a code outside the three unions', () => {
    const known = new Set(Object.values(UNIONS).flat());
    expect(Object.keys(PULSE_ERRORS).filter((code) => !known.has(code as PulseErrorCode))).toEqual(
      [],
    );
  });

  it('says what the plan says for the named cases', () => {
    expect(pulseErrorCopy({ code: 'restart_required' })).toMatchObject({
      copy: 'Close and reopen TimeHuddle to record',
      action: 'restart',
    });
    expect(pulseErrorCopy({ code: 'upload.too_large' }).action).toBe('trim');
    expect(pulseErrorCopy({ code: 'method.unsupported' }).action).toBe('update');
    expect(pulseErrorCopy({ code: 'storage.newer_schema' }).copy).toMatch(/send or delete/);
    expect(pulseErrorCopy({ code: 'destination.gone' }).action).toBe('move');
  });

  it('reads a clock-bound lock apart from a plain one', () => {
    const plain = pulseErrorCopy({ code: 'draft.locked' });
    const clockBound = pulseErrorCopy({ code: 'draft.locked', reason: 'clock_bound' });
    expect(clockBound.code).toBe('draft.locked');
    expect(clockBound.copy).not.toBe(plain.copy);
    expect(clockBound.copy).toMatch(/clock/);
  });

  it('shows something for anything else a call rejected with', () => {
    for (const thrown of [new TypeError('x is undefined'), 'boom', null, { code: 'brand.new' }]) {
      const shown = pulseErrorCopy(thrown);
      expect(shown.code).toBe('unknown');
      expect(shown.copy.trim()).not.toBe('');
    }
  });
});
