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

/** Guards against concurrent resets when several collections fail at once. */
let resetting = false;

/** sessionStorage marker so a checkpoint reset reloads at most once per tab. */
export const CHECKPOINT_RESET_KEY = "tickr_checkpoint_reset";

/**
 * Wipe the local database and reload so replication restarts from a clean
 * slate. Triggered when the server reports our sync checkpoint is older than
 * the tombstone purge horizon: an incremental pull could miss purged deletions,
 * so a full resync is the only way to stay consistent.
 *
 * Like the schema-reset path, the server is the source of truth via
 * replication, so wiping IndexedDB loses no synced data. Unpushed local edits
 * from a client offline longer than the purge window are the accepted tradeoff.
 *
 * Only reloads when the wipe actually succeeded and at most once per tab
 * session: a failed wipe (or a server that keeps replying 410) would otherwise
 * reload-loop forever instead of resyncing.
 *
 * @param {string} reason - Human-readable trigger, recorded for observability.
 * @returns {Promise<void>}
 */
export async function resetDatabase(reason) {
  if (resetting) return;
  resetting = true;
  reportError("checkpoint_reset", new Error(reason));

  // Already reset once this session: another reload would just loop. The marker
  // is cleared on the next successful pull (see replication.js).
  if (sessionStorage.getItem(CHECKPOINT_RESET_KEY)) {
    reportError(
      "checkpoint_reset_loop",
      new Error(`Checkpoint reset repeated without recovery: ${reason}`),
    );
    return;
  }

  let wiped = false;
  try {
    const db = await dbPromise;
    if (db) await db.remove();
    wiped = true;
  } catch {
    // The instance may already be unusable; fall back to a name-based wipe.
    try {
      await removeRxDatabase(DB_NAME, storage);
      wiped = true;
    } catch (err) {
      reportError("checkpoint_reset_wipe_failed", err);
    }
  }

  // Reload only if the local cache was actually cleared; reloading on a failed
  // wipe re-pulls the same stale checkpoint and loops.
  if (wiped) {
    sessionStorage.setItem(CHECKPOINT_RESET_KEY, String(Date.now()));
    window.location.reload();
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
