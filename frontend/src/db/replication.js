/**
 * Set up RxDB replication for lists and items collections.
 *
 * Uses the RxDB HTTP replication protocol with pull/push handlers
 * and an SSE-based event stream for real-time updates.
 */

import { replicateRxCollection } from "rxdb/plugins/replication";
import { Subject } from "rxjs";
import { authExpired$ } from "../bus.js";

/** Shared SSE connection state for all collections. */
let sharedEventSource = null;
let reconnectTimeout = null;
/** Set once a 401 is seen, to stop the SSE reconnect storm. */
let sessionExpired = false;
const collectionSubjects = {};
/** Active replication states, used to re-sync after a session is restored. */
let activeReplications = [];

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
 * Open a single SSE connection and route messages to per-collection subjects.
 *
 * Closes any existing connection before reconnecting.
 */
function connectSharedStream() {
  if (sharedEventSource) {
    sharedEventSource.close();
    sharedEventSource = null;
  }

  const eventSource = new EventSource("/api/v1/sync/stream");
  sharedEventSource = eventSource;

  eventSource.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      for (const [name, subject] of Object.entries(collectionSubjects)) {
        if (data.collection === name || data.collection === "all") {
          subject.next("RESYNC");
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  eventSource.addEventListener("error", () => {
    eventSource.close();
    sharedEventSource = null;
    if (sessionExpired) return;
    clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => connectSharedStream(), 3000);
  });
}

/**
 * Get an observable stream for a specific collection, creating the shared
 * SSE connection on first call.
 *
 * @param {string} collection - The collection name (e.g. "lists", "items").
 * @returns {import('rxjs').Observable} Observable that emits "RESYNC" events.
 */
function getCollectionStream(collection) {
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
  if (!sharedEventSource) return;

  sharedEventSource.close();
  sharedEventSource = null;
}

/**
 * Fully tear down the shared SSE connection and complete all collection
 * subjects. Use on unload — the subjects are not reusable afterwards.
 */
function cleanupSSE() {
  pauseSSE();
  for (const subject of Object.values(collectionSubjects)) {
    subject.complete();
  }
}

/**
 * Convert a server-side list document to RxDB format (snake_case -> camelCase).
 */
function serverListToClient(doc) {
  return {
    id: doc.id,
    name: doc.name,
    icon: doc.icon || "list",
    itemSort: doc.item_sort || "alphabetical",
    sortOrder: doc.sort_order ?? 0,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    _deleted: !!doc._deleted,
  };
}

/**
 * Convert a client-side list document to server format (camelCase -> snake_case).
 */
function clientListToServer(doc) {
  return {
    id: doc.id,
    name: doc.name,
    icon: doc.icon || "list",
    item_sort: doc.itemSort || "alphabetical",
    sort_order: doc.sortOrder ?? 0,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    _deleted: doc._deleted || false,
  };
}

/**
 * Convert a server-side item document to RxDB format.
 */
function serverItemToClient(doc) {
  return {
    id: doc.id,
    listId: doc.list_id,
    text: doc.text,
    completed: !!doc.completed,
    categoryId: doc.category_id || null,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    completedAt: doc.completed_at || null,
    _deleted: !!doc._deleted,
  };
}

/**
 * Convert a client-side item document to server format.
 */
function clientItemToServer(doc) {
  return {
    id: doc.id,
    list_id: doc.listId,
    text: doc.text,
    completed: doc.completed ? 1 : 0,
    category_id: doc.categoryId || null,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    completed_at: doc.completedAt || null,
    _deleted: doc._deleted || false,
  };
}

/**
 * Convert a server-side category document to RxDB format.
 */
function serverCategoryToClient(doc) {
  return {
    id: doc.id,
    listId: doc.list_id,
    name: doc.name,
    color: doc.color,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    _deleted: !!doc._deleted,
  };
}

/**
 * Convert a client-side category document to server format.
 */
function clientCategoryToServer(doc) {
  return {
    id: doc.id,
    list_id: doc.listId,
    name: doc.name,
    color: doc.color,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    _deleted: doc._deleted || false,
  };
}

/**
 * Create a pull handler for a given collection endpoint.
 *
 * @param {string} collection - The collection name (lists or items).
 * @param {Function} toClient - Converter from server to client format.
 * @returns {Object} Pull handler configuration for replicateRxCollection.
 */
function createPullHandler(collection, toClient) {
  return {
    async handler(checkpoint, batchSize) {
      const params = new URLSearchParams({ limit: String(batchSize) });
      if (checkpoint) {
        params.set("updated_at", checkpoint.updatedAt);
        params.set("id", checkpoint.id);
      }
      const response = await fetch(
        `/api/v1/sync/${collection}/pull?${params.toString()}`,
      );
      if (response.status === 401) {
        handleAuthExpired();
        throw new Error(`Pull unauthorized for ${collection}`);
      }
      if (!response.ok) {
        throw new Error(`Pull failed for ${collection}: ${response.status}`);
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
    retryTime: 5000,
    pull: createPullHandler("lists", serverListToClient),
    push: createPushHandler("lists", clientListToServer, serverListToClient),
    autoStart: true,
  });

  const itemsReplication = replicateRxCollection({
    collection: db.items,
    replicationIdentifier: "tickr-items-sync",
    live: true,
    retryTime: 5000,
    pull: createPullHandler("items", serverItemToClient),
    push: createPushHandler("items", clientItemToServer, serverItemToClient),
    autoStart: true,
  });

  const categoriesReplication = replicateRxCollection({
    collection: db.categories,
    replicationIdentifier: "tickr-categories-sync",
    live: true,
    retryTime: 5000,
    pull: createPullHandler("categories", serverCategoryToClient),
    push: createPushHandler(
      "categories",
      clientCategoryToServer,
      serverCategoryToClient,
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
