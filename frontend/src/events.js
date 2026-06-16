/**
 * Event listener wiring for the entire application.
 *
 * Exports a single setupEventListeners() function that delegates to small,
 * per-feature wire*() helpers. Called once during initialization.
 *
 * Note: .exec() calls below are RxDB query execution, not shell commands.
 */

import { state } from "./state.js";
import * as dom from "./dom.js";
import { getStorageItem, setStorageItem } from "./storage.js";
import { populateIconPicker, applyIconSelection } from "./icons.js";
import {
  createList,
  updateList,
  markListPendingDelete,
  commitListDelete,
  unmarkListPendingDelete,
  createItem,
  updateItem,
  markItemPendingDelete,
  commitItemDelete,
  unmarkItemPendingDelete,
  restoreItem,
  markHistoryPendingHide,
  unmarkHistoryPendingHide,
  commitHistoryHide,
  updateSettings,
  selectList,
  discardCategoryDraft,
  draftAddCategory,
  draftUpdateCategory,
  draftDeleteCategory,
  commitCategoryDraft,
} from "./data.js";
import {
  openEditListModal,
  openEditItemModal,
  fetchHistory,
  setHistorySort,
  toggleHistoryCard,
  toggleHistoryExpandAll,
  getHistoryCard,
  rerenderHistory,
  renderColorPalette,
  renderEditListCategories,
  renderItemCategoryOptions,
  resetCategoryForm,
} from "./render.js";
import { COLOR_PALETTE } from "./db/constants.js";
import { initDropdown, setDropdownValue, closeDropdown } from "./dropdown.js";
import { showUndoToast, showErrorToast, initToastListeners } from "./toast.js";
import { parseCategoryTag } from "./category-tag.js";
import { createCategoryAutocomplete } from "./add-item-autocomplete.js";
import { openMetrics, closeMetrics, setMetricsWindow } from "./metrics.js";
import { logout } from "./auth.js";
import { MODAL_FOCUS_DELAY_MS, LIST_SWIPE_ANIMATION_MS } from "./timing.js";

/** Close every modal/panel/overlay and reset transient UI state. */
function closeAllModals() {
  dom.newListModal.classList.remove("open");
  dom.editListModal.classList.remove("open");
  dom.editItemModal.classList.remove("open");
  dom.settingsModal.classList.remove("open");
  closeMetrics();
  dom.closeHistoryPanel();
  dom.overlay.classList.remove("visible");
  closeDropdown(dom.editItemCategoryDropdown);
  closeDropdown(dom.editListSortDropdown);
  closeDropdown(dom.listSortSettingDropdown);
  dom.closeMobileMenu();
  discardCategoryDraft();
  state.editingItemId = null;
  state.editingCategoryId = null;
  if (dom.editListCategoryForm)
    dom.editListCategoryForm.classList.remove("expanded");
  if (dom.editItemCategoryQuickForm)
    dom.editItemCategoryQuickForm.classList.remove("expanded");
}

/**
 * Pick the first palette color not yet used by any category in the current
 * list, falling back to a random palette entry when all are taken.
 */
function pickInitialColor() {
  const used = new Set(
    (state.categoryDraft ?? state.categories).map((c) => c.color),
  );
  const free = COLOR_PALETTE.find((c) => !used.has(c));
  if (free) return free;
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

/**
 * Wire backdrop-click dismissal for a modal. onClose (if provided) runs
 * after removing `open`, so transient state (e.g. editingItemId) can reset.
 *
 * @param {HTMLElement} modal
 * @param {() => void} [onClose]
 */
function makeBackdropDismiss(modal, onClose) {
  modal.addEventListener("click", (e) => {
    if (e.target !== modal) return;
    modal.classList.remove("open");
    onClose?.();
  });
}

/**
 * Wire Enter inside an expandable quick-create input to its local "Done"
 * button instead of letting the keypress bubble up and submit the enclosing
 * modal form. The `.expanded` guard prevents a repeat Enter from re-submitting
 * the still-focused (but visually collapsed) input.
 *
 * @param {HTMLElement} input - The quick-create text input.
 * @param {HTMLElement} form - The expandable wrapper carrying `.expanded`.
 * @param {HTMLElement} saveBtn - The local "Done" button to trigger.
 * @param {HTMLElement} [modalSaveBtn] - Element to focus after committing.
 */
function wireQuickFormEnter(input, form, saveBtn, modalSaveBtn) {
  input?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (!form.classList.contains("expanded")) return;
    e.preventDefault();
    e.stopPropagation();
    saveBtn.click();
    modalSaveBtn?.focus();
  });
}

/** Custom dropdowns, icon pickers, toast listeners, restored sidebar state. */
function wireInitialUi() {
  // Custom dropdowns (replace native <select>)
  // Selecting an existing category collapses the inline "+ New" form so the two
  // category modes (pick existing / create new) are never active at once.
  initDropdown(dom.editItemCategoryDropdown, () => {
    resetCategoryForm(dom.editItemCategoryQuickForm);
  });
  initDropdown(dom.editListSortDropdown);
  initDropdown(dom.listSortSettingDropdown);

  // Populate icon pickers
  populateIconPicker(dom.iconOptionsContainer);
  populateIconPicker(dom.editIconOptionsContainer);

  // Toast interaction listeners
  initToastListeners();

  // Restore sidebar state
  if (getStorageItem("sidebarCollapsed") === "true") {
    dom.sidebar.classList.add("collapsed");
  }
}

/** Sidebar nav, sidebar toggle, mobile menu, overlay dismissal. */
function wireNavigation() {
  // Navigation click delegation
  dom.navList.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const link = /** @type {HTMLElement} */ (target.closest(".nav-link"));
    if (!link) return;
    selectList(link.dataset.id);
    dom.closeMobileMenu();
  });

  // Sidebar toggle
  dom.sidebarToggle.addEventListener("click", () => {
    dom.sidebar.classList.toggle("collapsed");
    setStorageItem(
      "sidebarCollapsed",
      String(dom.sidebar.classList.contains("collapsed")),
    );
  });

  dom.mobileMenuBtn.addEventListener("click", dom.openMobileMenu);

  dom.overlay.addEventListener("click", () => {
    dom.closeMobileMenu();
    dom.closeHistoryPanel();
    dom.overlay.classList.remove("visible");
  });
}

/** Item checkbox/open delegation and the add-item form. */
function wireItems() {
  // Items checkbox delegation
  dom.itemsList.addEventListener("change", async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const checkbox = /** @type {HTMLInputElement} */ (
      target.closest('input[type="checkbox"]')
    );
    if (!checkbox) return;
    const itemEl = /** @type {HTMLElement} */ (checkbox.closest(".item"));
    if (!itemEl) return;
    const itemId = itemEl.dataset.id;
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    const isCompleted = checkbox.checked;
    const itemText = item.text;
    await updateItem(itemId, { completed: isCompleted });
    if (isCompleted) {
      showUndoToast(`"${itemText}" completed`, async () => {
        await updateItem(itemId, { completed: false });
      });
    }
  });

  // Items click delegation (open edit modal)
  dom.itemsList.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest(".item-checkbox")) return;
    const itemEl = /** @type {HTMLElement} */ (target.closest(".item"));
    if (!itemEl) return;
    const itemId = itemEl.dataset.id;
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    openEditItemModal(itemId, item.text);
  });

  // Add item — supports a trailing `#Name` / `#"Name with spaces"` tag to
  // assign a category inline, via its own autocomplete instance.
  const addItemAutocomplete = createCategoryAutocomplete(
    dom.addItemInput,
    dom.addItemCategoryAutocomplete,
  );

  dom.addItemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.currentListId) return;

    // An open autocomplete with a focused suggestion is "commit" intent,
    // not "submit" intent. Insert the tag and stay in the form.
    if (addItemAutocomplete.accept()) return;

    const raw = dom.addItemInput.value;
    const { cleanText, categoryName } = parseCategoryTag(raw);
    if (!cleanText) return;

    let categoryId = null;
    if (categoryName !== null) {
      const match = state.categories.find(
        (c) =>
          c.name.localeCompare(categoryName, undefined, {
            sensitivity: "base",
          }) === 0,
      );
      if (!match) {
        showErrorToast(`Category "${categoryName}" not found`);
        return;
      }
      categoryId = match.id;
    }

    await createItem(cleanText, undefined, categoryId);
    dom.addItemInput.value = "";
    addItemAutocomplete.hide();
  });
}

/** New-list and edit-list modals: icon pickers, create, update, delete. */
function wireListModals() {
  // Icon pickers
  dom.iconPickerToggle.addEventListener("click", () => {
    dom.iconPickerToggle.classList.toggle("open");
    dom.iconOptionsContainer.classList.toggle("expanded");
  });

  dom.editIconPickerToggle.addEventListener("click", () => {
    dom.editIconPickerToggle.classList.toggle("open");
    dom.editIconOptionsContainer.classList.toggle("expanded");
  });

  // Edit list
  dom.editListBtn.addEventListener("click", openEditListModal);

  // Delete list (with undo)
  dom.deleteListBtn.addEventListener("click", async () => {
    discardCategoryDraft();
    dom.editListModal.classList.remove("open");
    if (!state.currentListId || state.lists.length === 0) return;
    const list = state.lists.find((l) => l.id === state.currentListId);
    if (!list) return;
    const listName = list.name;
    const listId = list.id;

    // Deferred delete: hide the list now, finalize when the undo window
    // expires. Undo is a pure revert, so the list keeps its ID and history.
    const itemIds = await markListPendingDelete(listId);
    showUndoToast(`"${listName}" deleted`, {
      onUndo: () => unmarkListPendingDelete(listId, itemIds),
      onCommit: () => commitListDelete(listId, itemIds),
    });
  });

  // Add list modal
  dom.addListBtn.addEventListener("click", () => {
    dom.newListModal.classList.add("open");
    dom.newListName.value = "";
    state.selectedIcon = "list";
    applyIconSelection(
      dom.iconOptionsContainer,
      dom.iconPickerToggle,
      dom.iconPreview,
      state.selectedIcon,
    );
    setTimeout(() => dom.newListName.focus(), MODAL_FOCUS_DELAY_MS);
  });

  // Icon selection for new list
  dom.iconOptionsContainer.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const option = /** @type {HTMLElement} */ (target.closest(".icon-option"));
    if (!option) return;
    state.selectedIcon = option.dataset.icon;
    applyIconSelection(
      dom.iconOptionsContainer,
      dom.iconPickerToggle,
      dom.iconPreview,
      state.selectedIcon,
    );
  });

  // Icon selection for edit list
  dom.editIconOptionsContainer.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const option = /** @type {HTMLElement} */ (target.closest(".icon-option"));
    if (!option) return;
    state.editSelectedIcon = option.dataset.icon;
    applyIconSelection(
      dom.editIconOptionsContainer,
      dom.editIconPickerToggle,
      dom.editIconPreview,
      state.editSelectedIcon,
    );
  });

  // New list form
  dom.newListForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = dom.newListName.value.trim();
    if (name) {
      await createList(name, state.selectedIcon);
      dom.newListModal.classList.remove("open");
    }
  });

  dom.cancelNewList.addEventListener("click", () =>
    dom.newListModal.classList.remove("open"),
  );

  // Edit list form
  dom.editListForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = dom.editListName.value.trim();
    if (name && state.currentListId) {
      await commitCategoryDraft(state.currentListId);
      discardCategoryDraft();
      await updateList(
        state.currentListId,
        name,
        state.editSelectedIcon,
        dom.editListSort.value,
      );
      dom.editListModal.classList.remove("open");
    }
  });

  dom.cancelEditList.addEventListener("click", () => {
    discardCategoryDraft();
    dom.editListModal.classList.remove("open");
  });

  // Modal backdrop dismiss
  makeBackdropDismiss(dom.newListModal);
  makeBackdropDismiss(dom.editListModal, () => {
    discardCategoryDraft();
    resetCategoryForm(dom.editListCategoryForm);
  });
}

/** Edit-item modal: name/category form, delete, backdrop dismiss. */
function wireItemModal() {
  // Edit item supports a trailing `#Name` tag to assign a category inline,
  // via its own autocomplete instance with independent popup state.
  const editItemAutocomplete = createCategoryAutocomplete(
    dom.editItemText,
    dom.editItemCategoryAutocomplete,
    (cat) => setDropdownValue(dom.editItemCategoryDropdown, cat.id),
  );

  // Edit item form — the trailing `#Name` tag takes precedence over the
  // dropdown selection.
  dom.editItemForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // A focused suggestion is "commit" intent, not "submit" intent.
    if (editItemAutocomplete.accept()) return;

    const { cleanText, categoryName } = parseCategoryTag(
      dom.editItemText.value,
    );
    if (!cleanText || !state.editingItemId) return;

    const idMap = await commitCategoryDraft(state.currentListId);
    discardCategoryDraft();
    let categoryId = dom.editItemCategory.value || null;
    if (categoryId && idMap.has(categoryId)) {
      categoryId = idMap.get(categoryId);
    } else if (categoryId?.startsWith("tmp_")) {
      // Unmapped temp id means createCategory failed — don't store a
      // dangling reference on the item.
      categoryId = null;
    }

    // A typed tag overrides the dropdown selection.
    if (categoryName !== null) {
      const match = state.categories.find(
        (c) =>
          c.name.localeCompare(categoryName, undefined, {
            sensitivity: "base",
          }) === 0,
      );
      if (!match) {
        showErrorToast(`Category "${categoryName}" not found`);
        return;
      }
      categoryId = match.id;
    }

    await updateItem(state.editingItemId, { text: cleanText, categoryId });
    dom.editItemModal.classList.remove("open");
    state.editingItemId = null;
    editItemAutocomplete.hide();
  });

  dom.cancelEditItem.addEventListener("click", () => {
    discardCategoryDraft();
    dom.editItemModal.classList.remove("open");
    state.editingItemId = null;
  });

  // Delete item (with undo)
  dom.deleteEditItem.addEventListener("click", async () => {
    if (!state.editingItemId) return;
    const item = state.items.find((i) => i.id === state.editingItemId);
    const itemText = item ? item.text : "";
    const itemId = state.editingItemId;
    dom.editItemModal.classList.remove("open");
    state.editingItemId = null;

    // Deferred delete: hide the item now, finalize when the undo window
    // expires. Undo reverts in place, preserving completion, category and
    // original timestamps.
    await markItemPendingDelete(itemId);
    showUndoToast(`"${itemText}" deleted`, {
      onUndo: () => unmarkItemPendingDelete(itemId),
      onCommit: () => commitItemDelete(itemId),
    });
  });

  makeBackdropDismiss(dom.editItemModal, () => {
    discardCategoryDraft();
    state.editingItemId = null;
  });
}

/** Category quick-create (item modal) and management (list modal). */
function wireCategories() {
  // ---- Categories: Quick-create from item modal ----
  dom.editItemCategoryNew?.addEventListener("click", () => {
    // Entering "create new" mode clears any existing dropdown selection so only
    // one category mode is active at a time.
    setDropdownValue(dom.editItemCategoryDropdown, "");
    const initial = pickInitialColor();
    dom.editItemCategoryQuickName.value = "";
    dom.editItemCategoryQuickColor.value = initial;
    renderColorPalette(dom.editItemCategoryQuickSwatches, initial);
    dom.editItemCategoryQuickForm.classList.add("expanded");
    setTimeout(() => dom.editItemCategoryQuickName.focus(), 0);
  });

  dom.editItemCategoryQuickCancel?.addEventListener("click", () => {
    dom.editItemCategoryQuickForm.classList.remove("expanded");
  });

  dom.editItemCategoryQuickSwatches?.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const swatch = /** @type {HTMLElement} */ (target.closest(".color-swatch"));
    if (!swatch) return;
    const color = swatch.dataset.color;
    dom.editItemCategoryQuickColor.value = color;
    renderColorPalette(dom.editItemCategoryQuickSwatches, color);
  });

  dom.editItemCategoryQuickSave?.addEventListener("click", () => {
    const name = dom.editItemCategoryQuickName.value.trim();
    const color = dom.editItemCategoryQuickColor.value;
    if (!name) return;
    // Stage the new category in the draft and select it. It is only written to
    // the DB when the item modal is saved (commitCategoryDraft maps the temp
    // id to a real one), and discarded if the item modal is cancelled.
    const entry = draftAddCategory(name, color);
    dom.editItemCategory.value = entry.id;
    renderItemCategoryOptions();
    dom.editItemCategoryQuickForm.classList.remove("expanded");
  });

  wireQuickFormEnter(
    dom.editItemCategoryQuickName,
    dom.editItemCategoryQuickForm,
    dom.editItemCategoryQuickSave,
    dom.editItemSave,
  );

  // ---- Categories: Manage from list modal ----
  dom.editListCategoryAddBtn?.addEventListener("click", () => {
    state.editingCategoryId = null;
    const initial = pickInitialColor();
    dom.editListCategoryName.value = "";
    dom.editListCategoryColor.value = initial;
    renderColorPalette(dom.editListCategorySwatches, initial);
    dom.editListCategoryForm.classList.add("expanded");
    setTimeout(() => dom.editListCategoryName.focus(), 0);
  });

  dom.editListCategoryCancel?.addEventListener("click", () => {
    resetCategoryForm(dom.editListCategoryForm);
  });

  dom.editListCategorySwatches?.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const swatch = /** @type {HTMLElement} */ (target.closest(".color-swatch"));
    if (!swatch) return;
    const color = swatch.dataset.color;
    dom.editListCategoryColor.value = color;
    renderColorPalette(dom.editListCategorySwatches, color);
  });

  dom.editListCategorySave?.addEventListener("click", () => {
    const name = dom.editListCategoryName.value.trim();
    const color = dom.editListCategoryColor.value;
    if (!name) return;
    if (state.editingCategoryId) {
      draftUpdateCategory(state.editingCategoryId, { name, color });
    } else {
      draftAddCategory(name, color);
    }
    renderEditListCategories();
    resetCategoryForm(dom.editListCategoryForm);
  });

  wireQuickFormEnter(
    dom.editListCategoryName,
    dom.editListCategoryForm,
    dom.editListCategorySave,
    dom.editListSave,
  );

  dom.editListCategoriesList?.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row = /** @type {HTMLElement} */ (target.closest(".category-row"));
    if (!row) return;
    const id = row.dataset.id;
    if (target.closest(".category-edit")) {
      const cat = state.categoryDraft?.find((c) => c.id === id);
      if (!cat) return;
      state.editingCategoryId = id;
      dom.editListCategoryName.value = cat.name;
      dom.editListCategoryColor.value = cat.color;
      renderColorPalette(dom.editListCategorySwatches, cat.color);
      dom.editListCategoryForm.classList.add("expanded");
      setTimeout(() => dom.editListCategoryName.focus(), 0);
    } else if (target.closest(".category-delete")) {
      draftDeleteCategory(id);
      renderEditListCategories();
    }
  });
}

/** History panel open/close. */
function wireHistory() {
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
 * @param {string} [listId] - List to refresh; defaults to the current list.
 */
function refreshDrawer(listId = state.currentListId) {
  if (listId && listId === state.currentListId) fetchHistory(listId);
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

/** Metrics modal: open/close, time-range control, backdrop dismiss. */
function wireMetrics() {
  dom.metricsBtn.addEventListener("click", () => {
    openMetrics();
    dom.closeMobileMenu();
  });

  dom.closeMetricsBtn.addEventListener("click", closeMetrics);

  // Time-range segmented control: switch window and refresh.
  dom.metricsRange.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const btn = /** @type {HTMLElement} */ (
      target.closest("button[data-window]")
    );
    if (!btn) return;
    for (const b of dom.metricsRange.querySelectorAll("button")) {
      b.classList.toggle("active", b === btn);
    }
    setMetricsWindow(Number(btn.dataset.window));
  });

  makeBackdropDismiss(dom.metricsModal, closeMetrics);
}

/** Settings modal: open/save, clear cache, sign out, backdrop dismiss. */
function wireSettings() {
  dom.settingsBtn.addEventListener("click", () => {
    setDropdownValue(
      dom.listSortSettingDropdown,
      state.appSettings.list_sort || "alphabetical",
    );
    dom.settingsModal.classList.add("open");
    dom.closeMobileMenu();
  });

  dom.cancelSettings.addEventListener("click", () =>
    dom.settingsModal.classList.remove("open"),
  );

  dom.saveSettings.addEventListener("click", async () => {
    const newListSort = dom.listSortSetting.value;
    await updateSettings({ list_sort: newListSort });
    dom.settingsModal.classList.remove("open");
  });

  dom.clearCacheBtn.addEventListener("click", async () => {
    if (state.db) {
      await state.db.remove();
    }
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
    location.reload();
  });

  // Sign out: clear the server session, then reload so the auth gate re-renders.
  dom.logoutBtn?.addEventListener("click", async () => {
    await logout();
    location.reload();
  });

  makeBackdropDismiss(dom.settingsModal);
}

/** Global keyboard shortcuts: Escape closes modals, Ctrl/Cmd+N focuses input. */
function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllModals();
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key === "n" &&
      document.activeElement !== dom.addItemInput &&
      document.activeElement !== dom.newListName &&
      document.activeElement !== dom.editListName &&
      document.activeElement !== dom.editItemText
    ) {
      e.preventDefault();
      dom.addItemInput.focus();
    }
  });
}

/** Touch-swipe navigation between lists on the main content area. */
function wireSwipeNavigation() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  dom.mainContent.addEventListener(
    "touchstart",
    (e) => {
      const touch = /** @type {TouchEvent} */ (e);
      touchStartX = touch.changedTouches[0].screenX;
      touchStartY = touch.changedTouches[0].screenY;
    },
    { passive: true },
  );

  dom.mainContent.addEventListener(
    "touchend",
    (e) => {
      const touch = /** @type {TouchEvent} */ (e);
      touchEndX = touch.changedTouches[0].screenX;
      touchEndY = touch.changedTouches[0].screenY;
      handleSwipe();
    },
    { passive: true },
  );

  function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const minSwipeDistance = 80;
    if (
      Math.abs(deltaX) < minSwipeDistance ||
      Math.abs(deltaX) < Math.abs(deltaY)
    )
      return;

    const currentIndex = state.lists.findIndex(
      (l) => l.id === state.currentListId,
    );
    if (currentIndex === -1) return;

    const swipeLeft = deltaX < 0;
    let targetListId;
    if (swipeLeft) {
      const nextIndex = currentIndex + 1;
      targetListId =
        nextIndex < state.lists.length
          ? state.lists[nextIndex].id
          : state.lists[0].id;
    } else {
      const prevIndex = currentIndex - 1;
      targetListId =
        prevIndex >= 0
          ? state.lists[prevIndex].id
          : state.lists[state.lists.length - 1].id;
    }

    const outClass = swipeLeft ? "swipe-out-left" : "swipe-out-right";
    const inClass = swipeLeft ? "swipe-in-left" : "swipe-in-right";
    dom.itemsList.classList.add(outClass);
    dom.listTitle.classList.add("fade-out");
    setTimeout(() => {
      dom.itemsList.classList.remove(outClass);
      dom.listTitle.classList.remove("fade-out");
      selectList(targetListId);
      dom.itemsList.classList.add(inClass);
      dom.listTitle.classList.add("fade-in");
      setTimeout(() => {
        dom.itemsList.classList.remove(inClass);
        dom.listTitle.classList.remove("fade-in");
      }, LIST_SWIPE_ANIMATION_MS);
    }, LIST_SWIPE_ANIMATION_MS);
  }
}

/** Track the visual viewport height for modal positioning. */
function wireVisualViewport() {
  if (!window.visualViewport) return;

  function updateVisualViewport() {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty(
      "--visual-viewport-height",
      `${vv.height}px`,
    );
  }
  updateVisualViewport();
  window.visualViewport.addEventListener("resize", updateVisualViewport);
  window.visualViewport.addEventListener("scroll", updateVisualViewport);
}

/** Attach all application event listeners. */
export function setupEventListeners() {
  wireInitialUi();
  wireNavigation();
  wireItems();
  wireListModals();
  wireItemModal();
  wireCategories();
  wireHistory();
  wireMetrics();
  wireSettings();
  wireKeyboardShortcuts();
  wireSwipeNavigation();
  wireVisualViewport();
}
