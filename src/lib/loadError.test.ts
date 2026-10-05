import { describe, expect, it } from 'vitest';

import { ApiError } from './api';
import { classifyLoadError } from './loadError';

describe('classifyLoadError', () => {
  it('maps forbidden codes to forbidden', () => {
    expect(classifyLoadError(new ApiError('Not authorized', 500, 'forbidden'))).toBe('forbidden');
    expect(classifyLoadError(new ApiError('Nope', 500, 'not-authorized'))).toBe('forbidden');
  });

  it('maps not-found to not-found', () => {
    expect(classifyLoadError(new ApiError('Ticket not found', 500, 'not-found'))).toBe('not-found');
  });

  it('treats any other code as a plain error', () => {
    expect(classifyLoadError(new ApiError('Bad', 500, 'bad-request'))).toBe('error');
  });

  it('does not trust the HTTP status without a code', () => {
    expect(classifyLoadError(new ApiError('HTTP 404', 404))).toBe('error');
    expect(classifyLoadError(new ApiError('HTTP 403', 403))).toBe('error');
  });

  it('treats a non-API error (network, timeout) as a plain error', () => {
    expect(classifyLoadError(new Error('Failed to fetch'))).toBe('error');
    expect(classifyLoadError('boom')).toBe('error');
  });
});
