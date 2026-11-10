/**
 * Reopen the default list when the app becomes visible after being hidden for
 * longer than the idle timeout.
 *
 * Cold starts are handled by getInitialListId(); this covers resumes without a
 * reload: a backgrounded PWA on mobile, but also a minimised window or another
 * tab in front on desktop. Each tab tracks its own hide time.
 */

import * as dom from "../dom.js";
import { state } from "../state.js";
import {
  fetchSettings,
  isAppIdle,
  recordHidden,
  resolveDefaultListId,
  selectList,
  subscribeLists,
  updateSettings,
} from "../data.js";
import { reportError } from "../error-reporting.js";
import { showErrorToast } from "../toast.js";

/** @returns {boolean} Whether a modal or the history drawer is currently open. */
function isListBoundUiOpen() {
  return document.querySelector(".modal.open, .history-panel.open") !== null;
}

/** @returns {boolean} Whether the add-item field holds unsent text. */
function hasAddItemDraft() {
  return dom.addItemInput.value.trim() !== "";
}

/** Handle the app becoming visible again after being in the background. */
async function handleResume() {
  if (!isAppIdle(state.serverConfig)) return;
  try {
    const listIdBeforeFetch = state.currentListId;
    // Settings are HTTP-only (no SSE), so refetch to pick up a default changed
    // on another device while this one was in the background.
    await fetchSettings();
    // Re-render the sidebar so sort order and default marker match the settings.
    subscribeLists();
    // The user picked a list while settings were loading; their choice wins.
    if (state.currentListId !== listIdBeforeFetch) return;
    const defaultId = resolveDefaultListId(state.lists, state.appSettings);
    // Switching under an open modal, the history drawer or an unsent add-item
    // draft would retarget it to another list.
    if (
      !defaultId ||
      defaultId === state.currentListId ||
      isListBoundUiOpen() ||
      hasAddItemDraft()
    )
      return;
    selectList(defaultId);
  } catch (error) {
    reportError("reopen default list on resume", error);
  }
}

/**
 * Persist the edit-list "Open by default" checkbox when it changed. Unticking
 * the current default clears it, so no list is default.
 *
 * @param {string} listId - The list being edited.
 * @returns {Promise<void>}
 */
export async function saveDefaultListChoice(listId) {
  const isDefault = state.appSettings.default_list_id === listId;
  const wantsDefault = dom.editListDefault.checked;
  if (isDefault === wantsDefault) return;
  const saved = await updateSettings({
    default_list_id: wantsDefault ? listId : "",
  });
  if (!saved) showErrorToast("Failed to update default list");
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
