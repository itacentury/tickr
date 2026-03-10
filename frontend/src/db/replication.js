/**
 * Set up RxDB replication for lists and items collections.
 *
 * Uses the RxDB HTTP replication protocol with pull/push handlers
 * and an SSE-based event stream for real-time updates.
 */

import { replicateRxCollection } from "rxdb/plugins/replication";
import { Subject } from "rxjs";

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
    completed: doc.completed ? 1 : 0,
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
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    completed_at: doc.completedAt || null,
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
  const subject = new Subject();

  function connectStream() {
    const eventSource = new EventSource("/api/sync/stream");

    eventSource.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.collection === collection || data.collection === "all") {
          subject.next("RESYNC");
        }
      } catch {
        // Ignore malformed messages
      }
    });

    eventSource.addEventListener("error", () => {
      eventSource.close();
      setTimeout(() => connectStream(), 3000);
    });
  }

  connectStream();

  return {
    async handler(checkpoint, batchSize) {
      const params = new URLSearchParams({ limit: String(batchSize) });
      if (checkpoint) {
        params.set("updated_at", checkpoint.updatedAt);
        params.set("id", checkpoint.id);
      }
      const response = await fetch(
        `/api/sync/${collection}/pull?${params.toString()}`,
      );
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
    stream$: subject.asObservable(),
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
      const response = await fetch(`/api/sync/${collection}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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

  return { listsReplication, itemsReplication };
}
