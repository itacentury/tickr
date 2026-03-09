/**
 * Tickr App — slim orchestrator.
 *
 * Wires up the database, settings, subscriptions, replication, and
 * event listeners. The only public API is initApp(), consumed by main.js.
 */

import { getDatabase } from "./db/index.js";
import { setupReplication } from "./db/replication.js";
import { initSyncStatus } from "./sync-status.js";
import { state } from "./state.js";
import { fetchSettings, subscribeLists, subscribeItemCounts } from "./data.js";
import { setupEventListeners } from "./events.js";

/**
 * Initialize the app: set up RxDB, replication, and render initial state.
 */
export async function initApp() {
  state.db = await getDatabase();
  await fetchSettings();
  subscribeLists();
  subscribeItemCounts();

  const replications = setupReplication(state.db);
  initSyncStatus(replications);

  setupEventListeners();
}
