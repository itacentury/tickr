/**
 * Reopen the default list when the app returns from a long background period.
 *
 * Cold starts are handled by getInitialListId(); this covers PWAs that are
 * resumed from the background without a reload.
 */

import { state } from "../state.js";
import {
  fetchSettings,
  isAppIdle,
  recordHidden,
  resolveDefaultListId,
  selectList,
  subscribeLists,
} from "../data.js";

/** @returns {boolean} Whether a modal or the history drawer is currently open. */
function isListBoundUiOpen() {
  return document.querySelector(".modal.open, .history-panel.open") !== null;
}

/** Handle the app becoming visible again after being in the background. */
async function handleResume() {
  if (!isAppIdle(state.appSettings)) return;
  const listIdBeforeFetch = state.currentListId;
  // Settings are HTTP-only (no SSE), so refetch to pick up a default changed
  // on another device while this one was in the background.
  await fetchSettings();
  // Re-render the sidebar so sort order and default marker match the settings.
  subscribeLists();
  // The user picked a list while settings were loading; their choice wins.
  if (state.currentListId !== listIdBeforeFetch) return;
  const defaultId = resolveDefaultListId(state.lists, state.appSettings);
  // Switching under an open modal or the history drawer would retarget its
  // actions to another list.
  if (!defaultId || defaultId === state.currentListId || isListBoundUiOpen())
    return;
  selectList(defaultId);
}

/** Track background time and reopen the default list on resume. */
export function wireDefaultList() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      recordHidden();
      return;
    }
    handleResume();
  });
}
