/**
 * Track and display sync/online status based on replication state.
 *
 * Shows an "Offline" indicator when the network is unreachable and
 * a "Syncing" indicator during active replication.
 */

/**
 * Initialize sync status indicators and bind to replication states.
 *
 * @param {Object} replications - Object with listsReplication and itemsReplication.
 */
export function initSyncStatus(replications) {
  const offlineIndicator = document.getElementById("offlineIndicator");
  const syncIndicator = document.getElementById("syncIndicator");
  let isOffline = false;

  function updateOfflineUI(offline) {
    isOffline = offline;
    if (offlineIndicator) {
      offlineIndicator.classList.toggle("visible", offline);
    }
  }

  function updateSyncUI(syncing) {
    if (syncIndicator) {
      syncIndicator.classList.toggle("visible", syncing && !isOffline);
    }
  }

  // Track replication errors for offline detection
  for (const rep of Object.values(replications)) {
    rep.error$.subscribe((err) => {
      if (err) {
        updateOfflineUI(true);
      }
    });

    rep.active$.subscribe((active) => {
      updateSyncUI(active);
    });

    rep.received$.subscribe(() => {
      updateOfflineUI(false);
    });

    rep.sent$.subscribe(() => {
      updateOfflineUI(false);
    });
  }

  // Browser online/offline events
  window.addEventListener("online", () => updateOfflineUI(false));
  window.addEventListener("offline", () => updateOfflineUI(true));
}
