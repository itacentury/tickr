/**
 * Event listener wiring for the entire application.
 *
 * Exports a single setupEventListeners() function that delegates to small,
 * per-feature wire*() helpers. Called once during initialization.
 *
 * Note: .exec() calls below are RxDB query execution, not shell commands.
 */

import { firstValueFrom } from "rxjs";
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
import {
  MODAL_FOCUS_DELAY_MS,
  LIST_SWIPE_ANIMATION_MS,
  HISTORY_SYNC_WAIT_TIMEOUT_MS,
} from "./timing.js";

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

/**
 * Wire a color swatch grid: clicking a `.color-swatch` writes its color into
 * the backing input and re-renders the palette to mark the active swatch.
 *
 * @param {HTMLElement} container - The element holding the `.color-swatch`es.
 * @param {HTMLInputElement} valueInput - The hidden input storing the color.
 */
function wireColorSwatchPicker(container, valueInput) {
  container?.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const swatch = /** @type {HTMLElement} */ (target.closest(".color-swatch"));
    if (!swatch) return;
    const color = swatch.dataset.color;
    valueInput.value = color;
    renderColorPalette(container, color);
  });
}

/**
 * Populate an expandable category form with name/color, render its palette,
 * expand it and focus the name input. Shared by the "add new" and "edit
 * existing" entry points.
 *
 * @param {HTMLElement} form
 * @param {HTMLInputElement} nameInput
 * @param {HTMLInputElement} colorInput
 * @param {HTMLElement} swatches
 * @param {string} name
 * @param {string} color
 */
function fillCategoryForm(form, nameInput, colorInput, swatches, name, color) {
  nameInput.value = name;
  colorInput.value = color;
  renderColorPalette(swatches, color);
  form.classList.add("expanded");
  setTimeout(() => nameInput.focus(), 0);
}

/**
 * Wire an expandable quick-category form: open (blank, auto-picked color),
 * cancel, save (validate → persist → collapse), Enter handling and swatch
 * selection. Per-modal behavior is supplied via callbacks.
 *
 * @param {object} cfg
 * @param {HTMLElement} cfg.form
 * @param {HTMLInputElement} cfg.nameInput
 * @param {HTMLInputElement} cfg.colorInput
 * @param {HTMLElement} cfg.swatches
 * @param {HTMLElement} cfg.openBtn
 * @param {HTMLElement} cfg.cancelBtn
 * @param {HTMLElement} cfg.saveBtn
 * @param {HTMLElement} cfg.modalSaveBtn - Element to focus after committing via Enter.
 * @param {() => void} [cfg.onOpen] - Extra setup before the form expands.
 * @param {(name: string, color: string) => void} cfg.onSave - Persist the category.
 * @param {() => void} cfg.collapse - Collapse/reset the form.
 */
function wireQuickCategoryForm({
  form,
  nameInput,
  colorInput,
  swatches,
  openBtn,
  cancelBtn,
  saveBtn,
  modalSaveBtn,
  onOpen,
  onSave,
  collapse,
}) {
  wireColorSwatchPicker(swatches, colorInput);

  openBtn?.addEventListener("click", () => {
    onOpen?.();
    fillCategoryForm(
      form,
      nameInput,
      colorInput,
      swatches,
      "",
      pickInitialColor(),
    );
  });

  cancelBtn?.addEventListener("click", collapse);

  saveBtn?.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const color = colorInput.value;
    if (!name) return;
    onSave(name, color);
    collapse();
  });

  wireQuickFormEnter(nameInput, form, saveBtn, modalSaveBtn);
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
  wireQuickCategoryForm({
    form: dom.editItemCategoryQuickForm,
    nameInput: dom.editItemCategoryQuickName,
    colorInput: dom.editItemCategoryQuickColor,
    swatches: dom.editItemCategoryQuickSwatches,
    openBtn: dom.editItemCategoryNew,
    cancelBtn: dom.editItemCategoryQuickCancel,
    saveBtn: dom.editItemCategoryQuickSave,
    modalSaveBtn: dom.editItemSave,
    // Entering "create new" mode clears any existing dropdown selection so only
    // one category mode is active at a time.
    onOpen: () => setDropdownValue(dom.editItemCategoryDropdown, ""),
    onSave: (name, color) => {
      // Stage the new category in the draft and select it. It is only written
      // to the DB when the item modal is saved (commitCategoryDraft maps the
      // temp id to a real one), and discarded if the item modal is cancelled.
      const entry = draftAddCategory(name, color);
      dom.editItemCategory.value = entry.id;
      renderItemCategoryOptions();
    },
    collapse: () => dom.editItemCategoryQuickForm.classList.remove("expanded"),
  });

  // ---- Categories: Manage from list modal ----
  wireQuickCategoryForm({
    form: dom.editListCategoryForm,
    nameInput: dom.editListCategoryName,
    colorInput: dom.editListCategoryColor,
    swatches: dom.editListCategorySwatches,
    openBtn: dom.editListCategoryAddBtn,
    cancelBtn: dom.editListCategoryCancel,
    saveBtn: dom.editListCategorySave,
    modalSaveBtn: dom.editListSave,
    onOpen: () => {
      state.editingCategoryId = null;
    },
    onSave: (name, color) => {
      if (state.editingCategoryId) {
        draftUpdateCategory(state.editingCategoryId, { name, color });
      } else {
        draftAddCategory(name, color);
      }
      renderEditListCategories();
    },
    collapse: () => resetCategoryForm(dom.editListCategoryForm),
  });

  dom.editListCategoriesList?.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row = /** @type {HTMLElement} */ (target.closest(".category-row"));
    if (!row) return;
    const id = row.dataset.id;
    if (target.closest(".category-edit")) {
      const cat = state.categoryDraft?.find((c) => c.id === id);
      if (!cat) return;
      state.editingCategoryId = id;
      fillCategoryForm(
        dom.editListCategoryForm,
        dom.editListCategoryName,
        dom.editListCategoryColor,
        dom.editListCategorySwatches,
        cat.name,
        cat.color,
      );
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
