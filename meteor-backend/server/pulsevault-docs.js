/**
 * Hand-written OpenAPI 3.1 documentation for PulseVault's raw HTTP surface
 * (TUS upload + artifact serving). Wormhole's own `/api/openapi.json` is
 * generated purely from the Meteor-method registry (see the vendored
 * `wreiske:meteor-wormhole` package's `openapi.js`) and has no extension
 * point for hand-written paths, so these routes — which aren't Meteor
 * methods and can't be, since they carry binary TUS/video bytes Wormhole's
 * JSON-only REST bridge can't transport — get their own small Swagger page
 * at `/pulsevault/docs` instead of appearing on `/api/docs`.
 *
 * Route shapes and response contracts are taken directly from
 * `@mieweb/pulsevault`'s `PROTOCOL.md` (the wire protocol the package
 * implements), not invented here.
 */

const ERROR_RESPONSE_SCHEMA = {
  type: 'object',
  description: 'PulseVault protocol error shape (PROTOCOL.md §5.3).',
  properties: {
    ok: { type: 'boolean', const: false },
    error: { type: 'string' },
  },
  required: ['ok', 'error'],
};

const AUTH_HEADER_PARAM = {
  name: 'Authorization',
  in: 'header',
  required: true,
  description: 'Capability token: `Bearer <token>` (PROTOCOL.md §5.1).',
  schema: { type: 'string', example: 'Bearer <token>' },
};

const ARTIFACT_ID_PARAM = {
  name: 'artifactId',
  in: 'path',
  required: true,
  description: 'UUID minted by `pulsevault.reserve` / `pulsevault.reserveForLibrary`.',
  schema: { type: 'string', format: 'uuid' },
};

const UPLOAD_ID_PARAM = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'The artifactId returned by `POST /pulsevault/upload`\'s `Location` header.',
  schema: { type: 'string', format: 'uuid' },
};

export const pulsevaultOpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'PulseVault raw upload/playback API',
    version: '1.0.0',
    description:
      'Binary TUS resumable-upload and artifact-serving endpoints for video attachments. ' +
      'Mounted directly on Meteor (see `pulsevault.js`), documented separately from ' +
      '`/api/docs` since these carry raw bytes rather than JSON method calls.',
  },
  servers: [{ url: '/pulsevault' }],
  paths: {
    '/capabilities': {
      get: {
        summary: 'Protocol capabilities discovery',
        description: 'Unauthenticated. Advertises upload limits and supported artifact kinds.',
        operationId: 'pulsevault_capabilities',
        tags: ['pulsevault'],
        responses: {
          200: {
            description: 'Capabilities payload (PROTOCOL.md §2)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    protocolVersion: { type: 'integer' },
                    protocolRevision: { type: 'string', example: '2.3' },
                    minSupportedVersion: { type: 'integer' },
                    maxSupportedVersion: { type: 'integer' },
                    kinds: { type: 'array', items: { type: 'string' } },
                    allowedExtensions: { type: 'object' },
                    maxUploadSize: { type: 'integer', example: 524288000 },
                    viewLinks: { type: 'boolean' },
                    checksum: {
                      type: 'object',
                      properties: { algorithms: { type: 'array', items: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/upload': {
      post: {
        summary: 'Create a resumable upload (TUS creation)',
        description:
          'Standard TUS v1 creation request. `Upload-Metadata` must include `artifactId` ' +
          '(from `pulsevault.reserve`) and `filename`; `kind` defaults to `video`.',
        operationId: 'pulsevault_upload_create',
        tags: ['pulsevault'],
        parameters: [
          AUTH_HEADER_PARAM,
          {
            name: 'Upload-Length',
            in: 'header',
            required: true,
            schema: { type: 'integer' },
            description: 'Total upload size in bytes.',
          },
          {
            name: 'Upload-Metadata',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'Comma-separated `<key> <base64(value)>` pairs (PROTOCOL.md §4.1).',
          },
          {
            name: 'Tus-Resumable',
            in: 'header',
            required: true,
            schema: { type: 'string', example: '1.0.0' },
          },
        ],
        responses: {
          201: {
            description: 'Upload created. `Location` header points at `/upload/<id>` for PATCH/HEAD/DELETE.',
            headers: {
              Location: { schema: { type: 'string' }, description: 'MUST be validated same-origin (PROTOCOL.md §4.3).' },
            },
          },
          401: { description: 'Missing credential', content: { 'application/json': { schema: ERROR_RESPONSE_SCHEMA } } },
          403: {
            description:
              'Invalid/expired token, or not the shape of a pulse: a video under any id but the ' +
              "token's, or a thumbnail/manifest/captions not under its own id `relatedTo` the video.",
            content: { 'application/json': { schema: ERROR_RESPONSE_SCHEMA } },
          },
          409: {
            description:
              'An artifact already exists under this id: finished, or still uploading and not idle ' +
              'for 5 minutes (an idle unfinished upload of the same kind is taken over).',
          },
        },
      },
    },
    '/upload/{id}': {
      patch: {
        summary: 'Append a chunk at Upload-Offset',
        operationId: 'pulsevault_upload_patch',
        tags: ['pulsevault'],
        parameters: [
          UPLOAD_ID_PARAM,
          AUTH_HEADER_PARAM,
          { name: 'Upload-Offset', in: 'header', required: true, schema: { type: 'integer' } },
          { name: 'Tus-Resumable', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/offset+octet-stream': {
              schema: { type: 'string', format: 'binary', description: 'Raw bytes for this offset — never base64 or wrapped.' },
            },
          },
        },
        responses: {
          204: {
            description: 'Chunk accepted',
            headers: { 'Upload-Offset': { schema: { type: 'integer' } } },
          },
          409: {
            description: 'Offset mismatch — client MUST re-HEAD before resuming (PROTOCOL.md §4.2)',
            content: { 'application/json': { schema: ERROR_RESPONSE_SCHEMA } },
          },
        },
      },
      head: {
        summary: 'Query the current upload offset',
        operationId: 'pulsevault_upload_head',
        tags: ['pulsevault'],
        parameters: [UPLOAD_ID_PARAM, AUTH_HEADER_PARAM],
        responses: {
          200: {
            description: 'Authoritative offset — a client MUST use this rather than a locally cached count.',
            headers: {
              'Upload-Offset': { schema: { type: 'integer' } },
              'Upload-Length': { schema: { type: 'integer' } },
            },
          },
        },
      },
      delete: {
        summary: 'Cancel an in-flight upload',
        operationId: 'pulsevault_upload_delete',
        tags: ['pulsevault'],
        parameters: [UPLOAD_ID_PARAM, AUTH_HEADER_PARAM],
        responses: {
          204: { description: 'Upload cancelled' },
          403: { description: 'The upload has finished, or belongs to a finished video (`lockWhenReady`).' },
        },
      },
    },
    '/artifacts/{artifactId}': {
      get: {
        summary: 'Serve a finished artifact',
        description:
          'Public — no `Authorization` header required, though a `?token=` query param is ' +
          'accepted for deployments that choose to validate playback links (PROTOCOL.md §5.1).',
        operationId: 'pulsevault_artifact_get',
        tags: ['pulsevault'],
        parameters: [
          ARTIFACT_ID_PARAM,
          { name: 'token', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Artifact bytes, or a redirect to a URL serving them.',
            content: { 'video/mp4': { schema: { type: 'string', format: 'binary' } } },
          },
          404: {
            description: 'Not found, or upload not yet complete/validated (PROTOCOL.md §6.1) — never partial bytes.',
          },
        },
      },
      delete: {
        summary: 'Delete an artifact',
        description:
          'Refused once the video has landed (`lockWhenReady`): a finished artifact, or a file ' +
          'related to a finished video, answers 403 whatever token is presented.',
        operationId: 'pulsevault_artifact_delete',
        tags: ['pulsevault'],
        parameters: [ARTIFACT_ID_PARAM, AUTH_HEADER_PARAM],
        responses: {
          204: { description: 'Artifact deleted' },
          403: { description: 'The artifact is finished, or belongs to a finished video.' },
        },
      },
    },
    '/artifacts/{artifactId}/status': {
      get: {
        summary: 'Where an upload is',
        description:
          '`unknown`, `uploading` (with `bytesReceived` against `size`), `processing` while the ' +
          'video is made web-playable, or `ready`, plus `acknowledged` (the attach ran) and the ' +
          'recorded `outcome` (protocol 2.3, PROTOCOL.md §6.5). Authorized by the pairing token. Never cached.',
        operationId: 'pulsevault_artifact_status',
        tags: ['pulsevault'],
        parameters: [
          ARTIFACT_ID_PARAM,
          AUTH_HEADER_PARAM,
          { name: 'token', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'The upload\'s state.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['artifactId', 'state'],
                  properties: {
                    artifactId: { type: 'string', format: 'uuid' },
                    state: { type: 'string', enum: ['unknown', 'uploading', 'processing', 'ready'] },
                    kind: { type: 'string', enum: ['video', 'project', 'captions', 'thumbnail'] },
                    relatedTo: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    bytesReceived: { type: 'number' },
                    size: { type: 'number' },
                    acknowledged: { type: 'boolean' },
                    outcome: { description: 'What the attach recorded: `{ state: "done" | "kept", note?, reason? }`.' },
                  },
                },
              },
            },
          },
          403: { description: 'The token does not name this artifact.' },
        },
      },
    },
    '/artifacts/{artifactId}/poster': {
      get: {
        summary: "Serve a video's poster frame",
        description:
          'The finished thumbnail the Pulse app uploaded `relatedTo` the video, served like the ' +
          'artifact route (public here, as playback is). 404 until it has landed. Revalidated on every request.',
        operationId: 'pulsevault_artifact_poster',
        tags: ['pulsevault'],
        parameters: [ARTIFACT_ID_PARAM],
        responses: {
          200: {
            description: 'The poster image, in the type it was uploaded as.',
            content: {
              'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              'image/png': { schema: { type: 'string', format: 'binary' } },
            },
          },
          404: { description: 'The video has no finished poster frame.' },
        },
      },
    },
  },
};

// Mirrors the private `swaggerHtml()` helper in the vendored
// `wreiske:meteor-wormhole` package's `rest-bridge.js` (same CDN bundle,
// same version pin) for visual consistency with `/api/docs` — that helper
// isn't exported, so it's reproduced here rather than imported.
const SWAGGER_UI_VERSION = '5.18.2';

export function pulsevaultSwaggerHtml(specUrl) {
  const safeSpecUrl = JSON.stringify(specUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PulseVault API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: ${safeSpecUrl}, dom_id: '#swagger-ui' });
  </script>
</body>
</html>`;
}
