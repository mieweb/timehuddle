/**
 * Minimal DDP client + React hooks for the Meteor backend PoC (port 3100).
 *
 * Dependency-free implementation of the DDP protocol subset we need:
 * connect, method calls, and subscriptions with added/changed/removed merging.
 *
 * Auth: after connecting, calls the Meteor `auth.bridge` method with the
 * better-auth session token from localStorage (same token src/lib/api.ts uses),
 * which binds this DDP connection to the signed-in user.
 *
 * Live data flows through oplog-backed publications (`tickets.byTeam`,
 * `clock.liveForTeams`) — any write from the Fastify backend, Meteor REST
 * (wormhole), or even mongosh appears here without polling.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { METEOR_BASE_URL } from './api';

const METEOR_WS_URL = METEOR_BASE_URL.replace(/^http/, 'ws') + '/websocket';

type DdpDoc = { _id: string } & Record<string, unknown>;
type CollectionStore = Map<string, DdpDoc>;
type Listener = () => void;

/**
 * Meteor's MongoID.idStringify prefixes ObjectId-backed ids with '-'.
 * Strip it so ids match the 24-char hex strings the REST API uses.
 */
function normalizeId(id: string): string {
  return id.startsWith('-') ? id.slice(1) : id;
}

/** Decode EJSON wire values (e.g. {$date: ms}) into plain JS values. */
function fromEjson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(fromEjson);
  const obj = value as Record<string, unknown>;
  if (typeof obj.$date === 'number') return new Date(obj.$date).toISOString();
  if (obj.$type === 'oid' && typeof obj.$value === 'string') return obj.$value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fromEjson(v);
  return out;
}

interface DdpMessage {
  msg?: string;
  id?: string;
  collection?: string;
  fields?: Record<string, unknown>;
  cleared?: string[];
  result?: unknown;
  error?: { reason?: string; message?: string };
  subs?: string[];
  session?: string;
}

class DdpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pendingMethods = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readySubs = new Set<string>();
  private subReadyListeners = new Map<string, () => void>();
  private collections = new Map<string, CollectionStore>();
  private listeners = new Map<string, Set<Listener>>();
  private connectPromise: Promise<void> | null = null;
  private authPromise: Promise<void> | null = null;
  /** Subscriptions to restore after a reconnect. */
  private activeSubs = new Map<string, { name: string; params: unknown[] }>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  status: 'idle' | 'connecting' | 'connected' | 'failed' = 'idle';

  /** Connect (once) and authenticate the connection via auth.bridge. */
  public ensureConnected(): Promise<void> {
    if (!this.connectPromise) {
      this.status = 'connecting';
      this.connectPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('DDP connection timeout'));
        }, 5000);  // 5 second timeout

        const ws = new WebSocket(METEOR_WS_URL);
        this.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
        ws.onmessage = (e) => {
          const data = JSON.parse(e.data as string) as DdpMessage;
          if (data.msg === 'connected') {
            clearTimeout(timeout);
            this.status = 'connected';
            this.reconnectAttempt = 0;
            resolve();
          }
          this.handleMessage(data);
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          this.status = 'failed';
          reject(new Error('DDP connection failed'));
        };
        ws.onclose = () => {
          clearTimeout(timeout);
          if (this.status !== 'connected') reject(new Error('DDP connection closed'));
          this.status = 'failed';
          this.handleDisconnect();
        };
      });
    }
    return this.connectPromise;
  }

  /**
   * On socket drop (server restart, network blip): reject in-flight methods,
   * reset connection state, and reconnect with backoff — re-authing and
   * restoring every active subscription so live data resumes seamlessly.
   */
  private handleDisconnect(): void {
    for (const pending of this.pendingMethods.values()) {
      pending.reject(new Error('DDP connection lost'));
    }
    this.pendingMethods.clear();
    this.readySubs.clear();
    this.connectPromise = null;
    this.authPromise = null;
    this.ws = null;

    if (this.activeSubs.size === 0 || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureAuthed()
        .then(() => {
          // Drop stale docs — the server re-sends `added` for everything below.
          for (const [collection, store] of this.collections) {
            store.clear();
            this.notify(collection);
          }
          for (const [id, sub] of this.activeSubs) {
            this.ws!.send(JSON.stringify({ msg: 'sub', id, name: sub.name, params: sub.params }));
          }
        })
        .catch(() => {
          // ensureConnected's onclose fires handleDisconnect again → next backoff.
        });
    }, delay);
  }

  public async ensureAuthed(): Promise<void> {
    await this.ensureConnected();
    if (!this.authPromise) {
      this.authPromise = (async () => {
        // Try resume token first (handles reconnects automatically)
        const resumed = await this.tryResumeLogin();
        if (!resumed) {
          // Try proxy auth (Authentik via os.mieweb.org)
          await this.loginWithProxy();
        }
      })().catch(() => {
        // Reset so next call can retry
        this.authPromise = null;
      });
    }
    return this.authPromise ?? Promise.resolve();
  }

  private async tryResumeLogin(): Promise<boolean> {
    const resumeToken = localStorage.getItem('meteor_resume_token');
    if (!resumeToken) return false;
    try {
      await this.call('login', { resume: resumeToken });
      return true;
    } catch {
      localStorage.removeItem('meteor_resume_token');
      return false;
    }
  }

  async loginWithPassword(email: string, password: string): Promise<void> {
    await this.ensureConnected();
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const digest = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const result = await this.call('login', {
      emailPassword: {
        email: email.toLowerCase().trim(),
        password: { digest, algorithm: 'sha-256', raw: password }
      }
    });

    const loginResult = result as { token: string; id: string };
    if (loginResult?.token) {
      localStorage.setItem('meteor_resume_token', loginResult.token);
    }
  }

  async signUpWithPassword(email: string, password: string, name: string): Promise<void> {
    // Call the custom Meteor method we added in auth-bridge.js
    await this.call('accounts.createUser', { email, password, name });
    // After creating, log in immediately
    await this.loginWithPassword(email, password);
  }

  async loginWithProxy(): Promise<boolean> {
    try {
      const res = await fetch(`${METEOR_BASE_URL}/api/whoami`, {
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token: string };

      const result = await this.call('login', {
        proxyJwt: data.token,
      });
      const loginResult = result as { token: string };

      if (loginResult?.token) {
        localStorage.setItem('meteor_resume_token', loginResult.token);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Login via Meteor OAuth callback tokens.
   * After GitHub OAuth completes, Meteor redirects with meteor_token and meteor_resume params.
   */
  async loginWithMeteorToken(
    meteorToken: string,
    resumeToken: string,
  ): Promise<boolean> {
    try {
      await this.ensureConnected();

      // Login using the resume token Meteor issued
      const result = await this.call('login', {
        resume: resumeToken,
      });

      const loginResult = result as { token: string };
      if (loginResult?.token) {
        localStorage.setItem('meteor_resume_token', loginResult.token);
      }

      console.log('[DDP] logged in via GitHub OAuth');
      return true;
    } catch (err) {
      console.error('[DDP] GitHub login error:', err);
      return false;
    }
  }

  async getCurrentUser(): Promise<{ 
    id: string; 
    email: string; 
    name: string; 
    username: string | null;
    image: string | null;
    emailVerified: boolean;
  } | null> {
    try {
      // Use a timeout to prevent hanging
      const authedWithTimeout = Promise.race([
        this.ensureAuthed(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), 5000)
        )
      ]);
      await authedWithTimeout;
      
      const resumeToken = localStorage.getItem('meteor_resume_token');
      if (!resumeToken) return null;
      
      const result = await this.call('users.getCurrentUser', {});
      return result as { 
        id: string; 
        email: string; 
        name: string; 
        username: string | null;
        image: string | null;
        emailVerified: boolean;
      } | null;
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.call('logout');
    } catch {}
    localStorage.removeItem('meteor_resume_token');
  }

  private handleMessage(data: DdpMessage): void {
    switch (data.msg) {
      case 'ping':
        this.ws?.send(JSON.stringify({ msg: 'pong', ...(data.id ? { id: data.id } : {}) }));
        break;
      case 'result': {
        const pending = data.id ? this.pendingMethods.get(data.id) : undefined;
        if (pending && data.id) {
          this.pendingMethods.delete(data.id);
          if (data.error) pending.reject(new Error(data.error.reason ?? data.error.message));
          else pending.resolve(data.result);
        }
        break;
      }
      case 'added':
      case 'changed':
      case 'removed': {
        if (!data.collection || !data.id) break;
        const store = this.getStore(data.collection);
        const docId = normalizeId(data.id);
        const fields = fromEjson(data.fields ?? {}) as Record<string, unknown>;
        if (data.msg === 'added') {
          store.set(docId, { _id: docId, ...fields });
        } else if (data.msg === 'changed') {
          const existing = store.get(docId);
          if (existing) {
            const next = { ...existing, ...fields };
            for (const key of data.cleared ?? []) delete next[key];
            store.set(docId, next);
          }
        } else {
          store.delete(docId);
        }
        this.notify(data.collection);
        break;
      }
      case 'ready':
        for (const subId of data.subs ?? []) {
          this.readySubs.add(subId);
          this.subReadyListeners.get(subId)?.();
        }
        break;
    }
  }

  private getStore(collection: string): CollectionStore {
    let store = this.collections.get(collection);
    if (!store) {
      store = new Map();
      this.collections.set(collection, store);
    }
    return store;
  }

  private notify(collection: string): void {
    for (const fn of this.listeners.get(collection) ?? []) fn();
  }

  public async call(method: string, ...params: unknown[]): Promise<unknown> {
    await this.ensureConnected();
    const id = String(this.nextId++);
    // ADD THIS:
    if (method === 'login') {
    }
    return new Promise((resolve, reject) => {
      this.pendingMethods.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ msg: 'method', id, method, params }));
    });
  }

  /** Subscribe after auth; returns an unsubscribe function. */
  subscribe(name: string, params: unknown[], onReady?: () => void): () => void {
    const id = String(this.nextId++);
    let stopped = false;
    this.activeSubs.set(id, { name, params });
    void this.ensureAuthed().then(() => {
      if (stopped) return;
      if (onReady) this.subReadyListeners.set(id, onReady);
      this.ws!.send(JSON.stringify({ msg: 'sub', id, name, params }));
    });
    return () => {
      stopped = true;
      this.activeSubs.delete(id);
      this.subReadyListeners.delete(id);
      if (this.status === 'connected') {
        this.ws?.send(JSON.stringify({ msg: 'unsub', id }));
      }
    };
  }

  docs(collection: string): DdpDoc[] {
    return Array.from(this.getStore(collection).values());
  }

  onCollectionChange(collection: string, fn: Listener): () => void {
    let set = this.listeners.get(collection);
    if (!set) {
      set = new Set();
      this.listeners.set(collection, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }
}

/** Singleton client — one DDP connection per browser tab. */
let client: DdpClient | null = null;
export function getDdpClient(): DdpClient {
  if (!client) client = new DdpClient();
  return client;
}

/**
 * Reactive view of a published collection.
 * Re-renders whenever the server pushes added/changed/removed for `collection`.
 */
function useLiveCollection(
  collection: string,
  publication: string,
  params: unknown[],
): { docs: DdpDoc[]; ready: boolean } {
  const ddp = getDdpClient();
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const paramsKey = JSON.stringify(params);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    setReady(false);
    const offChange = ddp.onCollectionChange(collection, () => setVersion((v) => v + 1));
    const unsubscribe = ddp.subscribe(publication, paramsRef.current, () => setReady(true));
    return () => {
      offChange();
      unsubscribe();
    };
  }, [collection, publication, paramsKey]);

  const docs = useMemo(() => ddp.docs(collection), [ddp, collection, version]);
  return { docs, ready };
}

/** Live tickets for the given teams (oplog-reactive). */
export function useLiveTickets(teamIds: string[]) {
  return useLiveCollection('tickets', 'tickets.byTeam', [teamIds]);
}

/** Map a raw DDP ticket doc to the frontend Ticket shape used by ticketApi. */
export function ddpDocToTicket(doc: DdpDoc): import('./api').Ticket {
  const assignedTo = doc.assignedTo;
  return {
    id: doc._id,
    teamId: String(doc.teamId ?? ''),
    title: String(doc.title ?? ''),
    description: (doc.description as string | undefined) ?? null,
    github: String(doc.github ?? ''),
    status: String(doc.status ?? 'open'),
    priority: (doc.priority as string | undefined) ?? null,
    createdBy: String(doc.createdBy ?? ''),
    assignedTo: Array.isArray(assignedTo)
      ? assignedTo.map(String)
      : assignedTo
        ? [String(assignedTo)]
        : [],
    reviewedBy: (doc.reviewedBy as string | undefined) ?? null,
    reviewedAt: (doc.reviewedAt as string | undefined) ?? null,
    createdAt: String(doc.createdAt ?? ''),
    updatedAt: (doc.updatedAt as string | undefined) ?? null,
    sharedWithTimeharbor: doc.sharedWithTimeharbor as boolean | undefined,
  };
}

/** Map a raw DDP teams doc to the frontend Team shape. */
export function ddpDocToTeam(doc: DdpDoc): import('./api').Team {
  return {
    id: doc._id,
    orgId: String(doc.orgId ?? ''),
    parentTeamId: (doc.parentTeamId as string | undefined) ?? null,
    name: String(doc.name ?? ''),
    description: (doc.description as string | undefined) ?? null,
    members: Array.isArray(doc.members) ? doc.members.map(String) : [],
    admins: Array.isArray(doc.admins) ? doc.admins.map(String) : [],
    code: String(doc.code ?? ''),
    isPersonal: Boolean(doc.isPersonal),
    createdAt: String(doc.createdAt ?? ''),
    updatedAt: (doc.updatedAt as string | undefined) ?? null,
  };
}

/** Live "who is clocked in" events for the given teams (oplog-reactive). */
export function useLiveClockEvents(teamIds: string[]) {
  return useLiveCollection('clockevents', 'clock.liveForTeams', [teamIds]);
}

/** Map a raw DDP clockevents doc to the frontend ClockEvent shape. */
export function ddpDocToClockEvent(doc: DdpDoc): import('./api').ClockEvent {
  return {
    id: doc._id,
    userId: String(doc.userId ?? ''),
    teamId: String(doc.teamId ?? ''),
    startTime: Number(doc.startTime ?? 0),
    accumulatedTime: Number(doc.accumulatedTime ?? 0),
    endTime: typeof doc.endTime === 'number' ? doc.endTime : null,
  };
}

/** Map a raw DDP notifications doc to the frontend Notification shape. */
export function ddpDocToNotification(doc: DdpDoc): import('./api').Notification {
  return {
    id: doc._id,
    userId: String(doc.userId ?? ''),
    title: String(doc.title ?? ''),
    body: String(doc.body ?? ''),
    ...(doc.data ? { data: doc.data as Record<string, unknown> } : {}),
    read: Boolean(doc.read),
    createdAt: String(doc.createdAt ?? ''),
  };
}

/**
 * Subscribe to the current user's live notification inbox and invoke `onNew`
 * for each notification that arrives *after* the initial backlog — i.e. those
 * delivered live while connected. Replaces `notificationApi.openStream()`.
 *
 * The initial inbox (up to 200 docs) loaded on subscribe is snapshotted as
 * "already seen" so we don't replay old notifications as if they were new.
 * Returns an unsubscribe function.
 */
export function subscribeNewNotifications(
  onNew: (n: import('./api').Notification) => void,
): () => void {
  const ddp = getDdpClient();
  let seen: Set<string> | null = null;

  const offChange = ddp.onCollectionChange('notifications', () => {
    if (!seen) return; // backlog still loading — wait for the ready snapshot
    for (const doc of ddp.docs('notifications')) {
      if (!seen.has(doc._id)) {
        seen.add(doc._id);
        onNew(ddpDocToNotification(doc));
      }
    }
  });

  const unsubscribe = ddp.subscribe('notifications.liveForUser', [], () => {
    seen = new Set(ddp.docs('notifications').map((d) => d._id));
  });

  return () => {
    offChange();
    unsubscribe();
  };
}
