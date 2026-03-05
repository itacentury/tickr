/**
 * Track and display sync status based on replication state.
 *
 * Shows a "Syncing" indicator when replication is active for more
 * than 500ms, avoiding flicker on fast syncs.
 */

/**
 * Initialize sync status indicator and bind to replication states.
 *
 * @param {Object} replications - Object with listsReplication and itemsReplication.
 */
export function initSyncStatus(replications) {
  const syncIndicator = document.getElementById("syncIndicator");
  let syncShowTimeout = null;
  const SYNC_SHOW_DELAY = 500;

  function updateSyncUI(syncing) {
    if (!syncIndicator) return;
    if (syncing) {
      if (!syncShowTimeout) {
        syncShowTimeout = setTimeout(() => {
          syncIndicator.classList.add("visible");
        }, SYNC_SHOW_DELAY);
      }
    } else {
      clearTimeout(syncShowTimeout);
      syncShowTimeout = null;
      syncIndicator.classList.remove("visible");
    }
  }

  for (const rep of Object.values(replications)) {
    rep.active$.subscribe((active) => {
      updateSyncUI(active);
    });
  }
}
