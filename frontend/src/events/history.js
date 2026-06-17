/**
 * History panel event wiring and the status-dependent card actions.
 *
 * Covers opening/closing the history drawer, its sort/expand controls, and the
 * reopen/restore/remove card actions (each paired with an undo toast). Item
 * mutations sync via RxDB, but history is read over a separate server endpoint,
 * so refreshDrawer awaits the items push before re-fetching.
 */

import { firstValueFrom } from "rxjs";
import { state } from "../state.js";
import * as dom from "../dom.js";
import {
  updateItem,
  commitItemDelete,
  restoreItem,
  markHistoryPendingHide,
  unmarkHistoryPendingHide,
  commitHistoryHide,
} from "../data.js";
import {
  fetchHistory,
  setHistorySort,
  toggleHistoryCard,
  toggleHistoryExpandAll,
  getHistoryCard,
  rerenderHistory,
} from "../render.js";
import { showUndoToast } from "../toast.js";
import { HISTORY_SYNC_WAIT_TIMEOUT_MS } from "../timing.js";

/** History panel open/close. */
export function wireHistory() {
  dom.historyBtn.addEventListener("click", () => {
    if (state.currentListId) {
      fetchHistory(state.currentListId);
      dom.openHistoryPanel();
      dom.overlay.classList.add("visible");
    }
  });

  dom.closeHistoryBtn.addEventListener("click", () => {
    dom.closeHistoryPanel();
    dom.overlay.classList.remove("visible");
  });

  // Sort toggle (Newest / Oldest first).
  dom.historySort.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const btn = /** @type {HTMLElement} */ (target.closest(".seg-btn"));
    if (btn) setHistorySort(btn.dataset.sort);
  });

  // Expand all / Collapse all.
  dom.historyExpandAll.addEventListener("click", toggleHistoryExpandAll);

  // Card actions (reopen/restore/remove) and expand/collapse on click.
  dom.historyList.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const actBtn = /** @type {HTMLElement} */ (target.closest(".act-btn"));
    if (actBtn) {
      // Don't let the action also toggle the card.
      event.stopPropagation();
      const card = /** @type {HTMLElement} */ (actBtn.closest(".icard"));
      handleHistoryAction(actBtn.dataset.action, card.dataset.id);
      return;
    }
    const head = target.closest(".icard-head");
    if (head)
      toggleHistoryCard(
        /** @type {HTMLElement} */ (head.closest(".icard")).dataset.id,
      );
  });
  dom.historyList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = /** @type {HTMLElement} */ (event.target);
    const head = target.closest(".icard-head");
    if (!head) return;
    event.preventDefault();
    toggleHistoryCard(
      /** @type {HTMLElement} */ (head.closest(".icard")).dataset.id,
    );
  });
}

/**
 * Re-fetch the history for a list, but only while it is still the visible one.
 * Deferred undo/commit callbacks pass the list the action started on; if the
 * user switched lists meanwhile, skip the refresh so we don't overwrite the
 * now-visible drawer with a list the user already navigated away from.
 *
 * Item mutations (restore/reopen) sync via RxDB, but history is read over a
 * separate server endpoint, so we first await the items push before fetching —
 * otherwise the just-written history row would be missed on the first fetch.
 *
 * @param {string} [listId] - List to refresh; defaults to the current list.
 * @returns {Promise<void>} Resolves once the refresh has been issued or skipped.
 */
async function refreshDrawer(listId = state.currentListId) {
  if (!listId || listId !== state.currentListId) return;

  // Wait for pending local item writes (e.g. the restore upsert) to reach the
  // server before fetching, so the history row the server writes during the
  // push is already present on the first fetch. Stop waiting as soon as any of:
  //  - awaitInSync resolves (push landed — the happy path),
  //  - the push errors (backend unreachable, e.g. VPN off / server down — no
  //    point waiting, the history fetch will fail too but should fail fast),
  //  - the timeout fires (slow/hung push — fetch anyway, today's behaviour).
  // navigator.onLine is only a cheap instant-skip for the clearly-offline case;
  // it can't tell whether the backend itself is reachable, so error$ carries
  // that load.
  const items = state.replications?.itemsReplication;
  if (items && navigator.onLine) {
    await Promise.race([
      items.awaitInSync(),
      // firstValueFrom rejects if error$ completes without emitting (e.g. the
      // replication was cancelled); swallow that so the race never throws out
      // of refreshDrawer.
      firstValueFrom(items.error$).catch(() => {}),
      new Promise((resolve) =>
        setTimeout(resolve, HISTORY_SYNC_WAIT_TIMEOUT_MS),
      ),
    ]);
    // The user may have switched lists while we waited; don't overwrite the
    // now-visible drawer with the list the action started on.
    if (listId !== state.currentListId) return;
  }

  fetchHistory(listId);
}

/**
 * Run a status-dependent history card action (reopen/restore). Each is a real
 * item mutation paired with an undo toast whose undo performs the inverse.
 *
 * @param {string} action - "reopen" | "restore" | "remove".
 * @param {string} id - The item ID.
 */
async function handleHistoryAction(action, id) {
  const card = getHistoryCard(id);
  if (!card) return;

  // Capture once so every deferred callback acts on the list the action started
  // on, even if the user switches lists during the undo window.
  const listId = state.currentListId;

  if (action === "remove") {
    // Optimistically drop the card; defer the server hide to the undo window.
    markHistoryPendingHide(id);
    rerenderHistory();
    showUndoToast(`"${card.name}" removed from history`, {
      onUndo: () => {
        unmarkHistoryPendingHide(id);
        rerenderHistory();
      },
      onCommit: async () => {
        await commitHistoryHide(id, listId);
        refreshDrawer(listId);
      },
    });
    return;
  }

  if (action === "reopen") {
    await updateItem(id, { completed: false });
    showUndoToast(`"${card.name}" reopened`, {
      onUndo: async () => {
        await updateItem(id, { completed: true });
        refreshDrawer(listId);
      },
    });
  } else if (action === "restore") {
    // Prefer the creation event's time; fall back to the oldest visible event
    // when the creation row was hidden, to preserve ordering.
    const createdEvent = card.events.find((e) => e.type === "added");
    const createdAt =
      createdEvent?.timestamp ?? card.events[card.events.length - 1].timestamp;
    const restored = await restoreItem(id, {
      listId,
      text: card.name,
      categoryId: card.category?.id ?? null,
      createdAt,
    });
    // restoreItem already surfaced its own error toast; skip the success toast
    // (and the shared refresh below) so the user doesn't see contradictory toasts.
    if (!restored) return;
    showUndoToast(`"${card.name}" restored`, {
      onUndo: async () => {
        await commitItemDelete(id);
        refreshDrawer(listId);
      },
    });
  }

  // Shared refresh for the reopen/restore branches; the remove branch returns
  // early above because it already rerenders optimistically and only touches
  // the drawer on commit, so falling through here would refresh twice.
  refreshDrawer(listId);
}
