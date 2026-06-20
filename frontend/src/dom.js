/**
 * DOM element references and simple DOM helpers.
 *
 * All queries run at module-evaluation time, which is safe because
 * module scripts are deferred — the HTML is fully parsed first.
 * This is a leaf node — no imports from other app modules.
 */

/**
 * Resolve a `data-el` scripting hook to its element.
 *
 * @param {string} name - The `data-el` hook value.
 * @returns {HTMLElement} The hooked element (assumed present at module load).
 */
function el(name) {
  return /** @type {HTMLElement} */ (
    document.querySelector(`[data-el="${name}"]`)
  );
}

// Layout
export const appContainer = document.querySelector(".app");
export const sidebar = el("sidebar");
export const sidebarToggle = el("sidebarToggle");
export const mobileMenuBtn = el("mobileMenuBtn");
export const mainContent = document.querySelector(".main-content");
export const overlay = el("overlay");

// Navigation
export const navList = el("navList");
export const listTitle = el("listTitle");
export const listTitleIcon = el("listTitleIcon");

// Items
export const addItemForm = /** @type {HTMLFormElement} */ (el("addItemForm"));
export const addItemInput = /** @type {HTMLInputElement} */ (
  el("addItemInput")
);
export const addItemCategoryAutocomplete = /** @type {HTMLUListElement} */ (
  el("addItemCategoryAutocomplete")
);
export const itemsList = el("itemsList");
export const emptyState = el("emptyState");

// History
export const historyBtn = el("historyBtn");
export const historyPanel = el("historyPanel");
export const historyList = el("historyList");
export const closeHistoryBtn = el("closeHistoryBtn");
export const historySort = el("historySort");
export const historyExpandAll = el("historyExpandAll");

// List actions
export const deleteListBtn = el("deleteListBtn");
export const editListBtn = el("editListBtn");

// New List Modal
export const newListModal = el("newListModal");
export const addListBtn = el("addListBtn");
export const newListForm = /** @type {HTMLFormElement} */ (el("newListForm"));
export const newListName = /** @type {HTMLInputElement} */ (el("newListName"));
export const cancelNewList = el("cancelNewList");
export const iconPickerToggle = el("iconPickerToggle");
export const iconOptionsContainer = el("iconOptions");
export const iconPreview = el("iconPreview");

// Edit List Modal
export const editListModal = el("editListModal");
export const editListForm = /** @type {HTMLFormElement} */ (el("editListForm"));
export const editListName = /** @type {HTMLInputElement} */ (
  el("editListName")
);
export const cancelEditList = el("cancelEditList");
export const editListSave = el("editListSave");
export const editIconPickerToggle = el("editIconPickerToggle");
export const editIconOptionsContainer = el("editIconOptions");
export const editIconPreview = el("editIconPreview");
// Custom dropdown: `editListSort` holds the value (hidden input); the
// wrapper element is referenced separately for init/close.
export const editListSort = /** @type {HTMLInputElement} */ (
  el("editListSortValue")
);
export const editListSortDropdown = el("editListSort");

// Edit Item Modal
export const editItemModal = el("editItemModal");
export const editItemForm = /** @type {HTMLFormElement} */ (el("editItemForm"));
export const editItemText = /** @type {HTMLInputElement} */ (
  el("editItemText")
);
export const editItemCategoryAutocomplete = /** @type {HTMLUListElement} */ (
  el("editItemCategoryAutocomplete")
);
export const cancelEditItem = el("cancelEditItem");
export const editItemSave = el("editItemSave");
export const deleteEditItem = el("deleteEditItem");
// Custom dropdown: `editItemCategory` holds the value (hidden input); the
// wrapper element is referenced separately for init/close.
export const editItemCategory = /** @type {HTMLInputElement} */ (
  el("editItemCategoryValue")
);
export const editItemCategoryDropdown = el("editItemCategory");
export const editItemCategoryNew = el("editItemCategoryNew");
export const editItemCategoryQuickForm = el("editItemCategoryQuickForm");
export const editItemCategoryQuickName = /** @type {HTMLInputElement} */ (
  el("editItemCategoryQuickName")
);
export const editItemCategoryQuickColor = /** @type {HTMLInputElement} */ (
  el("editItemCategoryQuickColor")
);
export const editItemCategoryQuickSwatches = el(
  "editItemCategoryQuickSwatches",
);
export const editItemCategoryQuickSave = el("editItemCategoryQuickSave");
export const editItemCategoryQuickCancel = el("editItemCategoryQuickCancel");

// Edit List Modal — Categories section
export const editListCategoriesList = el("editListCategoriesList");
export const editListCategoryAddBtn = el("editListCategoryAddBtn");
export const editListCategoryForm = el("editListCategoryForm");
export const editListCategoryName = /** @type {HTMLInputElement} */ (
  el("editListCategoryName")
);
export const editListCategoryColor = /** @type {HTMLInputElement} */ (
  el("editListCategoryColor")
);
export const editListCategorySwatches = el("editListCategorySwatches");
export const editListCategorySave = el("editListCategorySave");
export const editListCategoryCancel = el("editListCategoryCancel");

// Undo Toast
export const undoToast = el("undoToast");
export const toastMessage = el("toastMessage");
export const toastUndo = el("toastUndo");
export const toastClose = el("toastClose");
export const toastProgress = el("toastProgress");

// Error Toast
export const errorToast = el("errorToast");
export const errorToastMessage = el("errorToastMessage");
export const errorToastClose = el("errorToastClose");
export const errorToastProgress = el("errorToastProgress");

// Metrics Modal
export const metricsModal = el("metricsModal");
export const metricsBtn = el("metricsBtn");
export const metricsBody = el("metricsBody");
export const closeMetricsBtn = el("closeMetrics");
export const metricsRange = el("metricsRange");

// Settings Modal
export const settingsModal = el("settingsModal");
export const settingsBtn = el("settingsBtn");
// Custom dropdown: `listSortSetting` holds the value (hidden input); the
// wrapper element is referenced separately for init/close.
export const listSortSetting = /** @type {HTMLInputElement} */ (
  el("listSortSettingValue")
);
export const listSortSettingDropdown = el("listSortSetting");
export const cancelSettings = el("cancelSettings");
export const saveSettings = el("saveSettings");
export const clearCacheBtn = el("clearCacheBtn");
export const accountSettingGroup = el("accountSettingGroup");
export const logoutBtn = el("logoutBtn");

/** Close the mobile sidebar menu. */
export function closeMobileMenu() {
  sidebar.classList.remove("mobile-open");
  overlay.classList.remove("visible");
}

/** Open the mobile sidebar menu. */
export function openMobileMenu() {
  sidebar.classList.add("mobile-open");
  overlay.classList.add("visible");
}

/** Open the history panel (visual + screen-reader state). */
export function openHistoryPanel() {
  historyPanel.classList.add("open");
  historyPanel.setAttribute("aria-hidden", "false");
}

/** Close the history panel (visual + screen-reader state). */
export function closeHistoryPanel() {
  historyPanel.classList.remove("open");
  historyPanel.setAttribute("aria-hidden", "true");
}

/**
 * Escape HTML special characters to prevent XSS when inserting into innerHTML.
 *
 * @param {*} value - Raw value to escape.
 * @returns {string} HTML-safe string.
 */
export function escapeHtml(value) {
  const el = document.createElement("span");
  el.textContent = String(value);
  return el.innerHTML;
}

/** Read a CSS custom property from :root, resolved to its computed value. */
export function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
