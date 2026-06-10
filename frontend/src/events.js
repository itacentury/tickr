// @ts-nocheck — DOM-heavy view module: checkJs cannot narrow event.target /
// querySelector results without per-callsite casts. Type-checked once it is
// split into smaller wiring functions (see TODO-frontend F13).
/**
 * Event listener wiring for the entire application.
 *
 * Exports a single setupEventListeners() function that attaches all
 * DOM event handlers. Called once during initialization.
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

/** Close every modal/panel/overlay and reset transient UI state. */
function closeAllModals() {
  dom.newListModal.classList.remove("open");
  dom.editListModal.classList.remove("open");
  dom.editItemModal.classList.remove("open");
  dom.settingsModal.classList.remove("open");
  closeMetrics();
  dom.historyPanel.classList.remove("open");
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

/** Attach all application event listeners. */
export function setupEventListeners() {
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

  // Navigation click delegation
  dom.navList.addEventListener("click", (e) => {
    const link = e.target.closest(".nav-link");
    if (!link) return;
    selectList(link.dataset.id);
    dom.closeMobileMenu();
  });

  // Items checkbox delegation
  dom.itemsList.addEventListener("change", async (e) => {
    const checkbox = e.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    const itemEl = checkbox.closest(".item");
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
    if (e.target.closest(".item-checkbox")) return;
    const itemEl = e.target.closest(".item");
    if (!itemEl) return;
    const itemId = itemEl.dataset.id;
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    openEditItemModal(itemId, item.text);
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
    dom.historyPanel.classList.remove("open");
    dom.overlay.classList.remove("visible");
  });

  // Icon pickers
  dom.iconPickerToggle.addEventListener("click", () => {
    dom.iconPickerToggle.classList.toggle("open");
    dom.iconOptionsContainer.classList.toggle("expanded");
  });

  dom.editIconPickerToggle.addEventListener("click", () => {
    dom.editIconPickerToggle.classList.toggle("open");
    dom.editIconOptionsContainer.classList.toggle("expanded");
  });

  // Add item & edit item — both support a trailing `#Name` / `#"Name with
  // spaces"` tag to assign a category inline. Each input gets its own
  // autocomplete instance with independent popup state.
  const addItemAutocomplete = createCategoryAutocomplete(
    dom.addItemInput,
    dom.addItemCategoryAutocomplete,
  );
  const editItemAutocomplete = createCategoryAutocomplete(
    dom.editItemText,
    dom.editItemCategoryAutocomplete,
    (cat) => setDropdownValue(dom.editItemCategoryDropdown, cat.id),
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

  // History
  dom.historyBtn.addEventListener("click", () => {
    if (state.currentListId) {
      fetchHistory(state.currentListId);
      dom.historyPanel.classList.add("open");
      dom.overlay.classList.add("visible");
    }
  });

  dom.closeHistoryBtn.addEventListener("click", () => {
    dom.historyPanel.classList.remove("open");
    dom.overlay.classList.remove("visible");
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
    setTimeout(() => dom.newListName.focus(), 100);
  });

  // Icon selection for new list
  dom.iconOptionsContainer.addEventListener("click", (e) => {
    const option = e.target.closest(".icon-option");
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
    const option = e.target.closest(".icon-option");
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

  // Edit item form — also supports a trailing `#Name` tag in the name field,
  // which takes precedence over the dropdown selection.
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
    const swatch = e.target.closest(".color-swatch");
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
    const swatch = e.target.closest(".color-swatch");
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
    const row = e.target.closest(".category-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".category-edit")) {
      const cat = state.categoryDraft?.find((c) => c.id === id);
      if (!cat) return;
      state.editingCategoryId = id;
      dom.editListCategoryName.value = cat.name;
      dom.editListCategoryColor.value = cat.color;
      renderColorPalette(dom.editListCategorySwatches, cat.color);
      dom.editListCategoryForm.classList.add("expanded");
      setTimeout(() => dom.editListCategoryName.focus(), 0);
    } else if (e.target.closest(".category-delete")) {
      draftDeleteCategory(id);
      renderEditListCategories();
    }
  });

  // Modal backdrop dismiss
  makeBackdropDismiss(dom.newListModal);
  makeBackdropDismiss(dom.editListModal, () => {
    discardCategoryDraft();
    resetCategoryForm(dom.editListCategoryForm);
  });
  makeBackdropDismiss(dom.editItemModal, () => {
    discardCategoryDraft();
    state.editingItemId = null;
  });

  // Metrics modal
  dom.metricsBtn.addEventListener("click", () => {
    openMetrics();
    dom.closeMobileMenu();
  });

  dom.closeMetricsBtn.addEventListener("click", closeMetrics);

  // Time-range segmented control: switch window and refresh.
  dom.metricsRange.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-window]");
    if (!btn) return;
    for (const b of dom.metricsRange.querySelectorAll("button")) {
      b.classList.toggle("active", b === btn);
    }
    setMetricsWindow(Number(btn.dataset.window));
  });

  makeBackdropDismiss(dom.metricsModal, closeMetrics);

  // Settings modal
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

  // Keyboard shortcuts
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

  // Restore sidebar state
  if (getStorageItem("sidebarCollapsed") === "true") {
    dom.sidebar.classList.add("collapsed");
  }

  // Touch swipe navigation
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  dom.mainContent.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    },
    { passive: true },
  );

  dom.mainContent.addEventListener(
    "touchend",
    (e) => {
      touchEndX = e.changedTouches[0].screenX;
      touchEndY = e.changedTouches[0].screenY;
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
      }, 150);
    }, 150);
  }

  // Visual viewport tracking for modal positioning
  if (window.visualViewport) {
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
}
