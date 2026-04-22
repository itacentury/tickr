/**
 * Initialize the RxDB database with lists and items collections.
 *
 * Uses Dexie (IndexedDB) storage which is free and open-source.
 */

import { createRxDatabase } from "rxdb/plugins/core";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { RxDBLeaderElectionPlugin } from "rxdb/plugins/leader-election";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { addRxPlugin } from "rxdb/plugins/core";
import { listSchema, itemSchema } from "./schemas.js";

addRxPlugin(RxDBLeaderElectionPlugin);
addRxPlugin(RxDBMigrationSchemaPlugin);

let dbPromise = null;

/**
 * Get or create the singleton RxDB database instance.
 *
 * @returns {Promise<import('rxdb').RxDatabase>} The database instance.
 */
export function getDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = _createDatabase().catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function _createDatabase() {
  const db = await createRxDatabase({
    name: "tickrdb",
    storage: getRxStorageDexie(),
    multiInstance: true,
  });

  await db.addCollections({
    lists: {
      schema: listSchema,
      migrationStrategies: {
        1: (doc) => doc,
      },
    },
    items: {
      schema: itemSchema,
      migrationStrategies: {
        1: (doc) => {
          doc.completed = !!doc.completed;
          return doc;
        },
      },
    },
  });

  return db;
}
