/**
 * loadError — Tells "you can't see this" apart from "this doesn't exist".
 *
 * Deep-linked pages (a ticket, a team) load one resource by id and must show a
 * different state for each case, never a generic "not found or no access".
 *
 * Only the Meteor.Error code is trusted, not the HTTP status: wormhole answers
 * every Meteor.Error with a 500, and its own bare 404 means "method not
 * registered", not "resource missing".
 */
import { ApiError } from './api';

export type LoadErrorKind = 'forbidden' | 'not-found' | 'error';

const KIND_BY_CODE: Record<string, LoadErrorKind> = {
  forbidden: 'forbidden',
  'not-authorized': 'forbidden',
  'not-found': 'not-found',
};

export function classifyLoadError(err: unknown): LoadErrorKind {
  if (!(err instanceof ApiError) || !err.code) return 'error';
  return KIND_BY_CODE[err.code] ?? 'error';
}
