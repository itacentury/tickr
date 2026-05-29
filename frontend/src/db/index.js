/**
 * Initialize the RxDB database with lists and items collections.
 *
 * Uses Dexie (IndexedDB) storage which is free and open-source.
 */

import {
  addRxPlugin,
  createRxDatabase,
  removeRxDatabase,
} from "rxdb/plugins/core";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { RxDBLeaderElectionPlugin } from "rxdb/plugins/leader-election";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { listSchema, itemSchema, categorySchema } from "./schemas.js";
import { reportError } from "../error-reporting.js";

addRxPlugin(RxDBLeaderElectionPlugin);
addRxPlugin(RxDBMigrationSchemaPlugin);

const DB_NAME = "tickrdb";
// One storage instance shared between create and remove paths so a self-heal
// reset operates on the same Dexie backend that failed to open.
const storage = getRxStorageDexie();

// RxDB error codes that indicate the local cache is unrecoverable but the
// server (source of truth via replication) can refill a fresh DB. Mostly
// schema/migration-related: DM* = migration plugin, DB6/DB8 = schema mismatch
// on collection open.
const RECOVERABLE_ERROR_CODES = new Set([
  "DM1",
  "DM2",
  "DM3",
  "DM4",
  "DM5",
  "DB6",
  "DB8",
]);

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
  try {
    return await _openDatabase();
  } catch (err) {
    if (!_isRecoverable(err)) throw err;
    // Local cache is unrecoverable (schema/migration conflict). Server is SoT
    // via replication, so wiping IndexedDB and re-opening loses no data.
    reportError("schema_reset", err);
    await removeRxDatabase(DB_NAME, storage);
    return _openDatabase();
  }
}

function _isRecoverable(err) {
  return RECOVERABLE_ERROR_CODES.has(err?.code);
}

async function _openDatabase() {
  const db = await createRxDatabase({
    name: DB_NAME,
    storage,
    multiInstance: true,
  });

  await db.addCollections({
    lists: {
      schema: listSchema,
      migrationStrategies: {
        1: (doc) => doc,
        // v2 only added maxLength constraints to existing fields (icon, id);
        // no data shape change. DB pre-check confirmed no documents exceed
        // the new limits, so an identity migration is sufficient.
        2: (doc) => doc,
      },
    },
    items: {
      schema: itemSchema,
      migrationStrategies: {
        1: (doc) => {
          doc.completed = !!doc.completed;
          return doc;
        },
        // v2 added maxLength constraints to listId/text and tightened id.
        // See note above for why an identity migration is safe here.
        2: (doc) => doc,
        // v3 introduced the optional categoryId field. Pre-existing docs
        // get an explicit null so RxDB queries `selector: { categoryId: null }`
        // behave deterministically.
        3: (doc) => {
          if (doc.categoryId === undefined) doc.categoryId = null;
          return doc;
        },
      },
    },
    categories: {
      schema: categorySchema,
    },
  });

  return db;
}
