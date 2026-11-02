/**
 * What a user's media library and profile Feed (media.list, media.listForUser
 * in uploads.js) leave out, with no Meteor or database: the media their Huddle
 * posts carry or show. Those belong to the post and its team, not to everyone
 * who may view the author's profile.
 */

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** An upload's path (/uploads/media/<file>) in Markdown, on its own or in a full URL. */
const MEDIA_URL = /\/uploads\/media\/[^\s)"'<>]+/g;

/** Each upload path in `text`, once. */
export function uploadUrlsIn(text) {
  if (typeof text !== 'string') return [];
  return [...new Set(text.match(MEDIA_URL) ?? [])];
}

/**
 * Mongo filter leaving out the `mediaitems` posts reference: by id
 * (`mediaIds`: a library row's own `_id`, or a Pulse video's `videoid`), and
 * by URL (`urls`: uploads a post shows in its text, such as a plan's pasted
 * screenshot the wrap-up's attachments replaced). `toObjectId` turns an `_id`
 * hex into the driver's ObjectId.
 */
export function excludingPostMedia({ mediaIds = new Set(), urls = new Set() } = {}, toObjectId = (id) => id) {
  const objectIds = [...mediaIds].filter((id) => OBJECT_ID.test(id)).map(toObjectId);
  const videoIds = [...mediaIds].filter((id) => !OBJECT_ID.test(id));
  return {
    ...(objectIds.length ? { _id: { $nin: objectIds } } : {}),
    ...(videoIds.length ? { videoid: { $nin: videoIds } } : {}),
    ...(urls.size ? { url: { $nin: [...urls] } } : {}),
  };
}
