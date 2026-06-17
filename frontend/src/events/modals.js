/**
 * Modal, navigation and item-list event wiring.
 *
 * Holds the general UI wiring that is not specific to categories, history,
 * gestures, metrics or settings: modal open/close lifecycle, sidebar/navigation,
 * the item checkbox/add-item flow, and the new/edit-list and edit-item modals.
 *
 * Note: .exec() calls below are RxDB query execution, not shell commands.
 */

import { state } from "../state.js";
import * as dom from "../dom.js";
import { getStorageItem, setStorageItem } from "../storage.js";
import { populateIconPicker, applyIconSelection } from "../icons.js";
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
  selectList,
  discardCategoryDraft,
  commitCategoryDraft,
} from "../data.js";
import {
  openEditListModal,
  openEditItemModal,
  resetCategoryForm,
} from "../render.js";
import { initDropdown, setDropdownValue, closeDropdown } from "../dropdown.js";
import { showUndoToast, showErrorToast, initToastListeners } from "../toast.js";
import { parseCategoryTag } from "../category-tag.js";
import { createCategoryAutocomplete } from "../add-item-autocomplete.js";
import { closeMetrics } from "../metrics.js";
import { makeBackdropDismiss } from "./modal-helpers.js";
import { MODAL_FOCUS_DELAY_MS } from "../timing.js";

/** Close every modal/panel/overlay and reset transient UI state. */
export function closeAllModals() {
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
 * Wire an icon picker: the toggle button expands/collapses the options, and
 * clicking an option reports the chosen icon and refreshes the preview.
 *
 * @param {HTMLElement} toggle - The button that opens the options container.
 * @param {HTMLElement} container - The element holding the `.icon-option`s.
 * @param {HTMLElement} preview - The element showing the selected icon.
 * @param {(icon: string) => void} onSelect - Receives the chosen icon name.
 */
function wireIconPicker(toggle, container, preview, onSelect) {
  toggle.addEventListener("click", () => {
    toggle.classList.toggle("open");
    container.classList.toggle("expanded");
  });

  container.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const option = /** @type {HTMLElement} */ (target.closest(".icon-option"));
    if (!option) return;
    const icon = option.dataset.icon;
    onSelect(icon);
    applyIconSelection(container, toggle, preview, icon);
  });
}

/** Custom dropdowns, icon pickers, toast listeners, restored sidebar state. */
export function wireInitialUi() {
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
export function wireNavigation() {
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
export function wireItems() {
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
export function wireListModals() {
  // Icon pickers
  wireIconPicker(
    dom.iconPickerToggle,
    dom.iconOptionsContainer,
    dom.iconPreview,
    (icon) => {
      state.selectedIcon = icon;
    },
  );
  wireIconPicker(
    dom.editIconPickerToggle,
    dom.editIconOptionsContainer,
    dom.editIconPreview,
    (icon) => {
      state.editSelectedIcon = icon;
    },
  );

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
export function wireItemModal() {
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
