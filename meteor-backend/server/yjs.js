/**
 * Live collaborative editing relay (Yjs) — Milestone 8.
 *
 * A minimal `y-websocket`-compatible server attached to Meteor's HTTP server on
 * a dedicated `/yjs` path (clear of DDP's `/websocket`). Each huddle post gets
 * its own room (`/yjs/<postId>`); the shared Y.Doc is held in memory only and
 * relayed between connected peers. There is **no** Y.Doc persistence: the
 * markdown stored on the post stays the source of truth (saves still go through
 * `huddle.updatePost`), and the first client to join seeds the room from that
 * markdown.
 *
 * Auth: the token is passed in the query string (`?token=…`), matching how the
 * frontend already authenticates — see `src/lib/ddp.ts`. Anonymous upgrades are
 * rejected. Per-post authorization (team membership) is intentionally left as a
 * follow-up; a room id is only obtainable by a client that can already see the
 * post.
 *
 * Protocol constants mirror the Kerebron `WebsocketProvider` (sync=0,
 * awareness=1), so the client's provider works unchanged.
 */
import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { resolveToken } from './auth-bridge';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const WS_PATH_PREFIX = '/yjs/';

/** Ping interval to detect and reap dead sockets (ms). */
const PING_TIMEOUT = 30000;

/** roomName -> WSSharedDoc */
const docs = new Map();

/**
 * A shared document for one room: a Y.Doc plus its awareness state and the set
 * of connected sockets. Updates and awareness changes are broadcast to peers.
 */
class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: true });
    this.name = name;
    /** @type {Map<import('ws').WebSocket, Set<number>>} conn -> controlled client ids */
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    this.awareness.on('update', ({ added, updated, removed }, conn) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const controlledIds = this.conns.get(conn);
        if (controlledIds) {
          added.forEach((clientId) => controlledIds.add(clientId));
          removed.forEach((clientId) => controlledIds.delete(clientId));
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
      const buf = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => send(this, c, buf));
    });

    this.on('update', (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const buf = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => {
        if (conn !== origin) send(this, conn, buf);
      });
    });
  }
}

/** Get (or lazily create) the shared doc for a room. */
function getYDoc(name) {
  let doc = docs.get(name);
  if (!doc) {
    doc = new WSSharedDoc(name);
    docs.set(name, doc);
  }
  return doc;
}

function send(doc, conn, message) {
  if (conn.readyState !== conn.OPEN && conn.readyState !== conn.CONNECTING) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(message, (err) => {
      if (err) closeConn(doc, conn);
    });
  } catch {
    closeConn(doc, conn);
  }
}

function closeConn(doc, conn) {
  const controlledIds = doc.conns.get(conn);
  if (controlledIds) {
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds),
      null,
    );
    // Drop the doc from memory once the last peer leaves — markdown in Mongo is
    // the source of truth, so nothing is lost.
    if (doc.conns.size === 0) {
      doc.destroy();
      docs.delete(doc.name);
    }
  }
  try {
    conn.close();
  } catch {
    /* already closed */
  }
}

function messageListener(conn, doc, message) {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case MESSAGE_SYNC:
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('[yjs] message error:', err);
    doc.emit('error', [err]);
  }
}

function setupConnection(conn, docName) {
  conn.binaryType = 'arraybuffer';
  const doc = getYDoc(docName);
  doc.conns.set(conn, new Set());

  conn.on('message', (message) =>
    messageListener(conn, doc, new Uint8Array(message)),
  );

  // Liveness ping/pong — reap sockets that stop responding.
  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) closeConn(doc, conn);
      clearInterval(pingInterval);
      return;
    }
    if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, PING_TIMEOUT);
  conn.on('pong', () => {
    pongReceived = true;
  });
  conn.on('close', () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });

  // Send the initial sync step 1 (our state vector) so the client can diff.
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
  }
  // Send current awareness states, if any.
  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        doc.awareness,
        Array.from(awarenessStates.keys()),
      ),
    );
    send(doc, conn, encoding.toUint8Array(encoder));
  }
}

Meteor.startup(() => {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (conn, _req, docName) => setupConnection(conn, docName));

  const httpServer = WebApp.httpServer;
  if (!httpServer) {
    console.error('[yjs] WebApp.httpServer unavailable — /yjs relay not started');
    return;
  }

  // Coexists with DDP/sockjs upgrade handlers: only act on our own path,
  // never touch or destroy sockets for other routes.
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    let token = '';
    try {
      const url = new URL(req.url, 'http://localhost');
      pathname = url.pathname;
      token = url.searchParams.get('token') || '';
    } catch {
      return;
    }

    if (!pathname.startsWith(WS_PATH_PREFIX)) return;

    const docName = decodeURIComponent(pathname.slice(WS_PATH_PREFIX.length));
    if (!docName) {
      socket.destroy();
      return;
    }

    // Authenticate before completing the handshake.
    Promise.resolve(resolveToken(token))
      .then((identity) => {
        if (!identity) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (conn) => {
          wss.emit('connection', conn, req, docName);
        });
      })
      .catch((err) => {
        console.error('[yjs] auth error:', err);
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
      });
  });

  console.log('[yjs] collaborative editing relay listening on /yjs/<room>');
});
