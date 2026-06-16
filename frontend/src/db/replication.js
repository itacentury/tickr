/**
 * Set up RxDB replication for lists and items collections.
 *
 * Uses the RxDB HTTP replication protocol with pull/push handlers
 * and an SSE-based event stream for real-time updates.
 */

import { replicateRxCollection } from "rxdb/plugins/replication";
import { Subject } from "rxjs";
import { authExpired$ } from "../bus.js";
import { reportError } from "../error-reporting.js";
import { resetDatabase, CHECKPOINT_RESET_KEY } from "./index.js";
import {
  REPLICATION_FETCH_TIMEOUT_MS,
  SSE_STALE_TIMEOUT_MS,
  SSE_RECONNECT_DELAY_MS,
  REPLICATION_RETRY_MS,
} from "../timing.js";

/** Shared SSE connection state for all collections. */
let sharedEventSource = null;
let reconnectTimeout = null;
let staleTimeout = null;
/** Set once a 401 is seen, to stop the SSE reconnect storm. */
let sessionExpired = false;
const collectionSubjects = {};
/** Active replication states, used to re-sync after a session is restored. */
let activeReplications = [];
/** Extra teardown callbacks (e.g. UI subscriptions) run during cleanupSSE. */
const teardownCallbacks = [];

/**
 * Register a teardown callback to run when the app fully tears down
 * (`cleanupSSE`, on unload). Used to dispose UI subscriptions that outlive a
 * single replication setup.
 *
 * @param {() => void} fn - Teardown callback.
 */
export function registerCleanup(fn) {
  teardownCallbacks.push(fn);
}

/**
 * Handle a 401 from any sync request: stop SSE, halt reconnects, and notify
 * the app to show the login gate.
 */
function handleAuthExpired() {
  if (sessionExpired) return;
  sessionExpired = true;
  pauseSSE();
  authExpired$.next();
}

/**
 * Resume sync after a successful re-login: clear the expired latch, reopen the
 * SSE stream, and trigger an immediate re-sync of all replications.
 *
 * The collection subjects survive the expired window (only paused, not
 * completed), so replication can restart in place without a full page reload.
 */
export function resumeReplication() {
  if (!sessionExpired) return;
  sessionExpired = false;
  if (Object.keys(collectionSubjects).length > 0) {
    connectSharedStream();
  }
  for (const rep of activeReplications) {
    rep.reSync();
  }
}

/**
 * Restart the staleness timer. Called on every observed frame (data or
 * heartbeat); if it ever fires, the connection is assumed silently dropped and
 * a fresh EventSource is opened — catching drops that never emit an `error`.
 */
function resetStaleTimer() {
  clearTimeout(staleTimeout);
  staleTimeout = setTimeout(() => connectSharedStream(), SSE_STALE_TIMEOUT_MS);
}

/**
 * Open a single SSE connection and route messages to per-collection subjects.
 *
 * Closes any existing connection before reconnecting.
 */
function connectSharedStream() {
  clearTimeout(reconnectTimeout);
  if (sharedEventSource) {
    sharedEventSource.close();
    sharedEventSource = null;
  }

  const eventSource = new EventSource("/api/v1/sync/stream");
  sharedEventSource = eventSource;
  resetStaleTimer();

  // Throttle malformed-frame reports to one per connection, so a server that
  // streams garbage doesn't flood the error endpoint. Reset on every reconnect.
  let malformedReported = false;
  eventSource.addEventListener("message", (event) => {
    resetStaleTimer();
    try {
      const data = JSON.parse(event.data);
      for (const [name, subject] of Object.entries(collectionSubjects)) {
        if (data.collection === name || data.collection === "all") {
          subject.next("RESYNC");
        }
      }
    } catch (err) {
      if (!malformedReported) {
        malformedReported = true;
        reportError(
          `parse SSE message (payload: ${String(event.data).slice(0, 200)})`,
          err,
        );
      }
    }
  });

  // Keepalive frames carry no payload; they exist only to prove liveness.
  eventSource.addEventListener("heartbeat", resetStaleTimer);

  eventSource.addEventListener("error", () => {
    eventSource.close();
    sharedEventSource = null;
    clearTimeout(staleTimeout);
    if (sessionExpired) return;
    clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(
      () => connectSharedStream(),
      SSE_RECONNECT_DELAY_MS,
    );
  });
}

/**
 * Get an observable stream for a specific collection, creating the shared
 * SSE connection on first call.
 *
 * @param {string} collection - The collection name (e.g. "lists", "items").
 * @returns {import('rxjs').Observable} Observable that emits "RESYNC" events.
 */
export function getCollectionStream(collection) {
  if (!collectionSubjects[collection]) {
    collectionSubjects[collection] = new Subject();
  }
  if (!sharedEventSource) {
    connectSharedStream();
  }
  return collectionSubjects[collection].asObservable();
}

/**
 * Close the shared SSE connection and stop reconnects, leaving the collection
 * subjects alive so the stream can be reopened later (e.g. after re-login).
 */
function pauseSSE() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (staleTimeout) {
    clearTimeout(staleTimeout);
    staleTimeout = null;
  }
  if (!sharedEventSource) return;

  sharedEventSource.close();
  sharedEventSource = null;
}

/**
 * Fully tear down the shared SSE connection, run registered teardown
 * callbacks, and complete and clear all collection subjects. Use on unload —
 * the subjects are not reusable afterwards.
 */
function cleanupSSE() {
  pauseSSE();
  while (teardownCallbacks.length > 0) {
    const fn = teardownCallbacks.pop();
    try {
      fn();
    } catch {
      // One bad teardown must not block the rest.
    }
  }
  for (const subject of Object.values(collectionSubjects)) {
    subject.complete();
  }
  for (const key of Object.keys(collectionSubjects)) {
    delete collectionSubjects[key];
  }
  activeReplications = [];
}

// Per-field value transforms. Plain key renames use `identity`; the rest carry
// the defaults and bool/int coercions the server and RxDB schemas expect.
const identity = (v) => v;
const orDefault = (d) => (v) => v || d; // falsy default (icon, item_sort)
const orNullish = (d) => (v) => v ?? d; // nullish default, keeps 0 (sort_order)
const orNull = (v) => v || null; // categoryId, completedAt
const toBool = (v) => !!v; // _deleted/completed -> client boolean
const toIntBool = (v) => (v ? 1 : 0); // completed -> server 1/0
const orFalse = (v) => v || false; // _deleted -> server

/**
 * Field maps per collection: `[clientKey, serverKey, toClientFn?, toServerFn?]`.
 * A missing transform defaults to `identity`. Single source of truth for the
 * snake_case <-> camelCase mapping shared by the generic converters below.
 */
const FIELD_MAPS = {
  lists: [
    ["id", "id"],
    ["name", "name"],
    ["icon", "icon", orDefault("list"), orDefault("list")],
    [
      "itemSort",
      "item_sort",
      orDefault("alphabetical"),
      orDefault("alphabetical"),
    ],
    ["sortOrder", "sort_order", orNullish(0), orNullish(0)],
    ["createdAt", "created_at"],
    ["updatedAt", "updated_at"],
    ["_deleted", "_deleted", toBool, orFalse],
  ],
  items: [
    ["id", "id"],
    ["listId", "list_id"],
    ["text", "text"],
    ["completed", "completed", toBool, toIntBool],
    ["categoryId", "category_id", orNull, orNull],
    ["createdAt", "created_at"],
    ["updatedAt", "updated_at"],
    ["completedAt", "completed_at", orNull, orNull],
    ["_deleted", "_deleted", toBool, orFalse],
  ],
  categories: [
    ["id", "id"],
    ["listId", "list_id"],
    ["name", "name"],
    ["color", "color"],
    ["createdAt", "created_at"],
    ["updatedAt", "updated_at"],
    ["_deleted", "_deleted", toBool, orFalse],
  ],
};

/**
 * Convert a server document to RxDB (client) format for the given collection.
 *
 * @param {string} collection - Collection name (lists, items, categories).
 * @param {Object} doc - Server-side document (snake_case).
 * @returns {Object} Client-side document (camelCase).
 */
export function toClient(collection, doc) {
  const result = {};
  for (const [clientKey, serverKey, toClientFn = identity] of FIELD_MAPS[
    collection
  ]) {
    result[clientKey] = toClientFn(doc[serverKey]);
  }
  return result;
}

/**
 * Convert an RxDB (client) document to server format for the given collection.
 *
 * @param {string} collection - Collection name (lists, items, categories).
 * @param {Object} doc - Client-side document (camelCase).
 * @returns {Object} Server-side document (snake_case).
 */
export function toServer(collection, doc) {
  const result = {};
  for (const [clientKey, serverKey, , toServerFn = identity] of FIELD_MAPS[
    collection
  ]) {
    result[serverKey] = toServerFn(doc[clientKey]);
  }
  return result;
}

/**
 * Create a pull handler for a given collection endpoint.
 *
 * @param {string} collection - The collection name (lists or items).
 * @param {Function} toClient - Converter from server to client format.
 * @returns {Object} Pull handler configuration for replicateRxCollection.
 */
export function createPullHandler(collection, toClient) {
  return {
    async handler(checkpoint, batchSize) {
      const params = new URLSearchParams({ limit: String(batchSize) });
      if (checkpoint) {
        params.set("updated_at", checkpoint.updatedAt);
        params.set("id", checkpoint.id);
        // Server stamp of when this checkpoint was handed out; the server's
        // stale-checkpoint guard judges sync recency by this, not by the
        // (possibly ancient) document timestamp in updatedAt.
        if (checkpoint.issuedAt) {
          params.set("issued_at", checkpoint.issuedAt);
        }
      }
      const response = await fetch(
        `/api/v1/sync/${collection}/pull?${params.toString()}`,
        { signal: AbortSignal.timeout(REPLICATION_FETCH_TIMEOUT_MS) },
      );
      if (response.status === 401) {
        handleAuthExpired();
        throw new Error(`Pull unauthorized for ${collection}`);
      }
      // 410 = our checkpoint predates the server's tombstone purge horizon, so
      // an incremental pull could miss deletions. Wipe and full-resync instead.
      // Must precede the generic !ok check, which would otherwise loop forever.
      if (response.status === 410) {
        resetDatabase(`Checkpoint too old for ${collection}`);
        throw new Error(`Checkpoint too old for ${collection}; resyncing`);
      }
      if (!response.ok) {
        throw new Error(`Pull failed for ${collection}: ${response.status}`);
      }
      // Only a successful pull WITH a checkpoint proves the checkpoint path is
      // healthy again, so only then clear the one-reset-per-session guard set
      // by resetDatabase. The checkpoint-less page-1 pull right after a reset
      // must not clear it — that would re-arm the wipe/reload loop if the
      // server keeps rejecting checkpoints.
      if (checkpoint) {
        sessionStorage.removeItem(CHECKPOINT_RESET_KEY);
      }
      const data = await response.json();
      return {
        documents: data.documents.map(toClient),
        checkpoint: data.checkpoint || null,
      };
    },
    batchSize: 100,
    stream$: getCollectionStream(collection),
  };
}

/**
 * Create a push handler for a given collection endpoint.
 *
 * @param {string} collection - The collection name (lists or items).
 * @param {Function} toServer - Converter from client to server format.
 * @param {Function} toClient - Converter from server to client format.
 * @returns {Object} Push handler configuration for replicateRxCollection.
 */
function createPushHandler(collection, toServer, toClient) {
  return {
    async handler(changeRows) {
      const body = changeRows.map((row) => ({
        newDocumentState: toServer(row.newDocumentState),
        assumedMasterState: row.assumedMasterState
          ? toServer(row.assumedMasterState)
          : null,
      }));
      const response = await fetch(`/api/v1/sync/${collection}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REPLICATION_FETCH_TIMEOUT_MS),
      });
      if (response.status === 401) {
        handleAuthExpired();
        throw new Error(`Push unauthorized for ${collection}`);
      }
      if (!response.ok) {
        throw new Error(`Push failed for ${collection}: ${response.status}`);
      }
      const conflicts = await response.json();
      return conflicts.map(toClient);
    },
    batchSize: 10,
  };
}

/**
 * Set up bidirectional replication for all collections.
 *
 * @param {import('rxdb').RxDatabase} db - The RxDB database instance.
 * @returns {Object} Replication states for lists and items.
 */
export function setupReplication(db) {
  const listsReplication = replicateRxCollection({
    collection: db.lists,
    replicationIdentifier: "tickr-lists-sync",
    live: true,
    retryTime: REPLICATION_RETRY_MS,
    pull: createPullHandler("lists", (d) => toClient("lists", d)),
    push: createPushHandler(
      "lists",
      (d) => toServer("lists", d),
      (d) => toClient("lists", d),
    ),
    autoStart: true,
  });

  const itemsReplication = replicateRxCollection({
    collection: db.items,
    replicationIdentifier: "tickr-items-sync",
    live: true,
    retryTime: REPLICATION_RETRY_MS,
    pull: createPullHandler("items", (d) => toClient("items", d)),
    push: createPushHandler(
      "items",
      (d) => toServer("items", d),
      (d) => toClient("items", d),
    ),
    autoStart: true,
  });

  const categoriesReplication = replicateRxCollection({
    collection: db.categories,
    replicationIdentifier: "tickr-categories-sync",
    live: true,
    retryTime: REPLICATION_RETRY_MS,
    pull: createPullHandler("categories", (d) => toClient("categories", d)),
    push: createPushHandler(
      "categories",
      (d) => toServer("categories", d),
      (d) => toClient("categories", d),
    ),
    autoStart: true,
  });

  window.addEventListener("beforeunload", cleanupSSE);

  activeReplications = [
    listsReplication,
    itemsReplication,
    categoriesReplication,
  ];

  const result = { listsReplication, itemsReplication, categoriesReplication };
  Object.defineProperty(result, "cleanup", {
    value: cleanupSSE,
    enumerable: false,
  });
  return result;
}
