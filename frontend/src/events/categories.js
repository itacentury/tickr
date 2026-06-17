/**
 * Category quick-create and management event wiring.
 *
 * Covers the inline "+ New" category form in the edit-item modal and the
 * category management form in the edit-list modal, plus the small shared
 * helpers for color picking, form filling and Enter handling.
 */

import { state } from "../state.js";
import * as dom from "../dom.js";
import {
  draftAddCategory,
  draftUpdateCategory,
  draftDeleteCategory,
} from "../data.js";
import {
  renderColorPalette,
  renderEditListCategories,
  renderItemCategoryOptions,
  resetCategoryForm,
} from "../render.js";
import { COLOR_PALETTE } from "../db/constants.js";
import { setDropdownValue } from "../dropdown.js";

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

/** Category quick-create (item modal) and management (list modal). */
export function wireCategories() {
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
