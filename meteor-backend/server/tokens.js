import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { createHash, randomBytes } from 'crypto';
import { rawDb, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';
import { emitActivity } from './activity-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const TOKEN_PREFIX = 'th_pat_';

function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

Meteor.methods({
  async 'tokens.list'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const tokens = await rawDb()
      .collection('personal_access_tokens')
      .find({ userId: userId }, { projection: { tokenHash: 0, userId: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    return {
      tokens: tokens.map((t) => ({
        _id: t._id.toHexString(),
        name: t.name,
        createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
        lastUsedAt: t.lastUsedAt instanceof Date ? t.lastUsedAt.toISOString() : (t.lastUsedAt ?? null),
      })),
    };
  },

  async 'tokens.create'({ name }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (typeof name !== 'string' || !name.trim() || name.length > 100) {
      throw new Meteor.Error('bad-request', 'name is required (1-100 chars)');
    }

    const rawToken = TOKEN_PREFIX + randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenId = new ObjectId();

    await rawDb().collection('personal_access_tokens').insertOne({
      _id: tokenId,
      userId: userId,
      tokenHash,
      name: name.trim(),
      createdAt: new Date(),
    });

    emitActivity({
      userId: userId,
      actor: { id: userId, name: 'User' },
      type: 'pat.created',
      payload: { tokenId: tokenId.toHexString(), name: name.trim() },
    }).catch(() => {});

    return { token: rawToken, name: name.trim() };
  },

  async 'tokens.revoke'({ tokenId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(tokenId)) throw new Meteor.Error('not-found', 'Invalid token id');

    const result = await rawDb().collection('personal_access_tokens').deleteOne({
      _id: new ObjectId(tokenId),
      userId: userId,
    });

    if (result.deletedCount === 0) throw new Meteor.Error('not-found', 'Token not found');

    emitActivity({
      userId: userId,
      actor: { id: userId, name: 'User' },
      type: 'pat.revoked',
      payload: { tokenId },
    }).catch(() => {});

    return { success: true };
  },
});
