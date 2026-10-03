// Archived from meteor-backend/server/uploads.js — see README.md in this folder.
// Not runnable on its own: it used uploads.js's module-level helpers
// (setCors, authenticateRequest, parseMultipart, THUMBNAILS_DIR, …).

// ── Media thumbnail upload (/api/media-thumbnail/:id) ─────────────────────────

WebApp.connectHandlers.use('/api/media-thumbnail/', async (req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const match = req.url.match(/^\/?([0-9a-f]{24})$/);
  if (!match || req.method !== 'POST') return next();

  const mediaId = match[1];
  const identity = await authenticateRequest(req);
  if (!identity) return sendJson(res, 401, { error: 'Unauthorized' });

  const db = rawDb();
  const item = await db.collection('mediaitems').findOne({ _id: new ObjectId(mediaId) });
  if (!item) return sendJson(res, 404, { error: 'Not found' });
  if (item.userId !== identity.userId) return sendJson(res, 403, { error: 'Forbidden' });

  let file;
  try {
    file = await parseMultipart(req, ['image/jpeg', 'image/png', 'image/webp']);
    if (file.size === 0) throw new Error('Empty file');

    await fsp.mkdir(THUMBNAILS_DIR, { recursive: true });
    const hex = randomBytes(8).toString('hex');
    const filename = `${identity.userId}-${hex}.jpg`;
    await fsp.rename(file.path, path.join(THUMBNAILS_DIR, filename));

    const previousPath = resolveUploadPath(item.thumbnail, '/uploads/thumbnails/', THUMBNAILS_DIR);
    const thumbnailUrl = `/uploads/thumbnails/${filename}`;

    const updated = await db
      .collection('mediaitems')
      .findOneAndUpdate(
        { _id: new ObjectId(mediaId) },
        { $set: { thumbnail: thumbnailUrl } },
        { returnDocument: 'after' },
      );

    if (previousPath && previousPath !== path.join(THUMBNAILS_DIR, filename)) {
      unlinkSafe(previousPath);
    }

    return sendJson(res, 200, {
      item: {
        id: updated._id.toHexString(),
        userId: updated.userId,
        type: updated.type,
        mimeType: updated.mimeType,
        url: updated.url,
        videoid: updated.videoid ?? null,
        filename: updated.filename,
        size: updated.size,
        title: updated.title ?? null,
        caption: updated.caption ?? null,
        altText: updated.altText ?? null,
        thumbnail: updated.thumbnail ?? null,
        uploadedAt:
          updated.uploadedAt instanceof Date
            ? updated.uploadedAt.toISOString()
            : String(updated.uploadedAt),
      },
    });
  } catch (err) {
    unlinkSafe(file?.path);
    return sendJson(res, err.statusCode ?? 400, { error: err.message });
  }
});
