import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const VALID_KINDS = ['clock', 'ticket'];
const VALID_TYPES = ['video', 'image', 'link'];

function toPublic(a) {
  return {
    id: a._id.toHexString ? a._id.toHexString() : String(a._id),
    url: a.url,
    type: a.type,
    title: a.title ?? null,
    thumbnail: a.thumbnail ?? null,
    attachedTo: a.attachedTo,
    addedBy: a.addedBy,
    addedAt: a.addedAt instanceof Date ? a.addedAt.toISOString() : String(a.addedAt),
  };
}

function isYouTubeUrl(url) {
  return /(?:youtube\.com\/watch|youtu\.be\/)/i.test(url);
}

async function fetchYouTubeTitle(url) {
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.title ?? null;
  } catch {
    return null;
  }
}

Meteor.methods({
  async 'attachments.list'({ kind, id }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Not logged in');
    }
    if (!VALID_KINDS.includes(kind)) throw new Meteor.Error('bad-request', 'Invalid kind');
    if (typeof id !== 'string' || !id) throw new Meteor.Error('bad-request', 'id is required');

    const docs = await rawDb().collection('attachments')
      .find({ 'attachedTo.kind': kind, 'attachedTo.id': id })
      .sort({ addedAt: 1 })
      .toArray();
    return { attachments: docs.map(toPublic) };
  },

  async 'attachments.add'({ url, type, title, thumbnail, attachedTo }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Not logged in');
    }
    const userId = this.userId;
    if (typeof url !== 'string' || !url.trim()) throw new Meteor.Error('bad-request', 'url is required');
    if (!VALID_TYPES.includes(type)) throw new Meteor.Error('bad-request', 'Invalid type');
    if (!attachedTo?.kind || !attachedTo?.id) throw new Meteor.Error('bad-request', 'attachedTo is required');
    if (!VALID_KINDS.includes(attachedTo.kind)) throw new Meteor.Error('bad-request', 'Invalid attachedTo.kind');

    const resolvedTitle = title ?? (isYouTubeUrl(url) ? await fetchYouTubeTitle(url) : undefined);

    const doc = {
      _id: new ObjectId(),
      url: url.trim(),
      type,
      ...(resolvedTitle ? { title: resolvedTitle } : {}),
      ...(thumbnail ? { thumbnail } : {}),
      attachedTo,
      addedBy: userId,
      addedAt: new Date(),
    };
    await rawDb().collection('attachments').insertOne(doc);
    return { attachment: toPublic(doc) };
  },

  async 'attachments.remove'({ attachmentId }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Not logged in');
    }
    const userId = this.userId;
    if (!isValidId(attachmentId)) throw new Meteor.Error('not-found', 'Invalid attachment id');
    const doc = await rawDb().collection('attachments').findOne({ _id: new ObjectId(attachmentId) });
    if (!doc) throw new Meteor.Error('not-found', 'Attachment not found');
    if (doc.addedBy !== userId) throw new Meteor.Error('forbidden', 'Not the owner');
    await rawDb().collection('attachments').deleteOne({ _id: doc._id });
    return { ok: true };
  },
});
