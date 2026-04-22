import { Mongo } from 'meteor/mongo';

import type { MessageDoc } from './schema';

// ─── Collection ───────────────────────────────────────────────────────────────

export const Messages = new Mongo.Collection<MessageDoc>('messages');
