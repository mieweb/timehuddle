import { Mongo } from 'meteor/mongo';

import type { ClockEventDoc, SessionDoc } from './schema';

// ─── Collections ──────────────────────────────────────────────────────────────

export const ClockEvents = new Mongo.Collection<ClockEventDoc>('clockevents');
export const Sessions = new Mongo.Collection<SessionDoc>('sessions');
