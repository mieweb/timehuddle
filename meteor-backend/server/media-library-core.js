/**
 * What a user's media library and profile Feed (media.list, media.listForUser
 * in uploads.js) leave out, with no Meteor or database: the media Huddle posts
 * carry or show — their own posts, and others' they added an upload to (an
 * admin's edit). Those belong to the post and its team, not to everyone who
 * may view the uploader's profile.
 */

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * An upload's path (/uploads/media/<file>) in Markdown, on its own or in a full
 * URL, without a query or fragment (`#page=2` is the same upload).
 */
const MEDIA_URL = /\/uploads\/media\/[^\s)"'<>?#]+/g;

/** Each upload path in `text`, once. */
export function uploadUrlsIn(text) {
  if (typeof text !== 'string') return [];
  return [...new Set(text.match(MEDIA_URL) ?? [])];
}

/**
 * Every id a post's attachment may name these media items by (`mediaId`): the
 * item's own `_id`, or its Pulse video's `videoid`.
 */
export function mediaRefsOf(items) {
  return items.flatMap((item) => [item._id.toHexString(), ...(item.videoid ? [item.videoid] : [])]);
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
