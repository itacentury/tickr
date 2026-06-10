/**
 * DOM element references and simple DOM helpers.
 *
 * All queries run at module-evaluation time, which is safe because
 * module scripts are deferred — the HTML is fully parsed first.
 * This is a leaf node — no imports from other app modules.
 */

// Layout
export const appContainer = document.querySelector(".app");
export const sidebar = document.getElementById("sidebar");
export const sidebarToggle = document.getElementById("sidebarToggle");
export const mobileMenuBtn = document.getElementById("mobileMenuBtn");
export const mainContent = document.querySelector(".main-content");
export const overlay = document.getElementById("overlay");

// Navigation
export const navList = document.getElementById("navList");
export const listTitle = document.getElementById("listTitle");
export const listTitleIcon = document.getElementById("listTitleIcon");

// Items
export const addItemForm = /** @type {HTMLFormElement} */ (
  document.getElementById("addItemForm")
);
export const addItemInput = /** @type {HTMLInputElement} */ (
  document.getElementById("addItemInput")
);
export const addItemCategoryAutocomplete = /** @type {HTMLUListElement} */ (
  document.getElementById("addItemCategoryAutocomplete")
);
export const itemsList = document.getElementById("itemsList");
export const emptyState = document.getElementById("emptyState");

// History
export const historyBtn = document.getElementById("historyBtn");
export const historyPanel = document.getElementById("historyPanel");
export const historyList = document.getElementById("historyList");
export const closeHistoryBtn = document.getElementById("closeHistoryBtn");

// List actions
export const deleteListBtn = document.getElementById("deleteListBtn");
export const editListBtn = document.getElementById("editListBtn");

// New List Modal
export const newListModal = document.getElementById("newListModal");
export const addListBtn = document.getElementById("addListBtn");
export const newListForm = /** @type {HTMLFormElement} */ (
  document.getElementById("newListForm")
);
export const newListName = /** @type {HTMLInputElement} */ (
  document.getElementById("newListName")
);
export const cancelNewList = document.getElementById("cancelNewList");
export const iconPickerToggle = document.getElementById("iconPickerToggle");
export const iconOptionsContainer = document.getElementById("iconOptions");
export const iconPreview = document.getElementById("iconPreview");

// Edit List Modal
export const editListModal = document.getElementById("editListModal");
export const editListForm = /** @type {HTMLFormElement} */ (
  document.getElementById("editListForm")
);
export const editListName = /** @type {HTMLInputElement} */ (
  document.getElementById("editListName")
);
export const cancelEditList = document.getElementById("cancelEditList");
export const editListSave = document.getElementById("editListSave");
export const editIconPickerToggle = document.getElementById(
  "editIconPickerToggle",
);
export const editIconOptionsContainer =
  document.getElementById("editIconOptions");
export const editIconPreview = document.getElementById("editIconPreview");
// Custom dropdown: `editListSort` holds the value (hidden input); the
// wrapper element is referenced separately for init/close.
export const editListSort = /** @type {HTMLInputElement} */ (
  document.getElementById("editListSortValue")
);
export const editListSortDropdown = document.getElementById("editListSort");

// Edit Item Modal
export const editItemModal = document.getElementById("editItemModal");
export const editItemForm = /** @type {HTMLFormElement} */ (
  document.getElementById("editItemForm")
);
export const editItemText = /** @type {HTMLInputElement} */ (
  document.getElementById("editItemText")
);
export const editItemCategoryAutocomplete = /** @type {HTMLUListElement} */ (
  document.getElementById("editItemCategoryAutocomplete")
);
export const cancelEditItem = document.getElementById("cancelEditItem");
export const editItemSave = document.getElementById("editItemSave");
export const deleteEditItem = document.getElementById("deleteEditItem");
// Custom dropdown: `editItemCategory` holds the value (hidden input); the
// wrapper element is referenced separately for init/close.
export const editItemCategory = /** @type {HTMLInputElement} */ (
  document.getElementById("editItemCategoryValue")
);
export const editItemCategoryDropdown =
  document.getElementById("editItemCategory");
export const editItemCategoryNew = document.getElementById(
  "editItemCategoryNew",
);
export const editItemCategoryQuickForm = document.getElementById(
  "editItemCategoryQuickForm",
);
export const editItemCategoryQuickName = /** @type {HTMLInputElement} */ (
  document.getElementById("editItemCategoryQuickName")
);
export const editItemCategoryQuickColor = /** @type {HTMLInputElement} */ (
  document.getElementById("editItemCategoryQuickColor")
);
export const editItemCategoryQuickSwatches = document.getElementById(
  "editItemCategoryQuickSwatches",
);
export const editItemCategoryQuickSave = document.getElementById(
  "editItemCategoryQuickSave",
);
export const editItemCategoryQuickCancel = document.getElementById(
  "editItemCategoryQuickCancel",
);

// Edit List Modal — Categories section
export const editListCategoriesList = document.getElementById(
  "editListCategoriesList",
);
export const editListCategoryAddBtn = document.getElementById(
  "editListCategoryAddBtn",
);
export const editListCategoryForm = document.getElementById(
  "editListCategoryForm",
);
export const editListCategoryName = /** @type {HTMLInputElement} */ (
  document.getElementById("editListCategoryName")
);
export const editListCategoryColor = /** @type {HTMLInputElement} */ (
  document.getElementById("editListCategoryColor")
);
export const editListCategorySwatches = document.getElementById(
  "editListCategorySwatches",
);
export const editListCategorySave = document.getElementById(
  "editListCategorySave",
);
export const editListCategoryCancel = document.getElementById(
  "editListCategoryCancel",
);

// Undo Toast
export const undoToast = document.getElementById("undoToast");
export const toastMessage = document.getElementById("toastMessage");
export const toastUndo = document.getElementById("toastUndo");
export const toastClose = document.getElementById("toastClose");
export const toastProgress = document.getElementById("toastProgress");

// Error Toast
export const errorToast = document.getElementById("errorToast");
export const errorToastMessage = document.getElementById("errorToastMessage");
export const errorToastClose = document.getElementById("errorToastClose");
export const errorToastProgress = document.getElementById("errorToastProgress");

// Metrics Modal
export const metricsModal = document.getElementById("metricsModal");
export const metricsBtn = document.getElementById("metricsBtn");
export const metricsBody = document.getElementById("metricsBody");
export const closeMetricsBtn = document.getElementById("closeMetrics");
export const metricsRange = document.getElementById("metricsRange");

// Settings Modal
export const settingsModal = document.getElementById("settingsModal");
export const settingsBtn = document.getElementById("settingsBtn");
// Custom dropdown: `listSortSetting` holds the value (hidden input); the
// wrapper element is referenced separately for init/close.
export const listSortSetting = /** @type {HTMLInputElement} */ (
  document.getElementById("listSortSettingValue")
);
export const listSortSettingDropdown =
  document.getElementById("listSortSetting");
export const cancelSettings = document.getElementById("cancelSettings");
export const saveSettings = document.getElementById("saveSettings");
export const clearCacheBtn = document.getElementById("clearCacheBtn");
export const accountSettingGroup = document.getElementById(
  "accountSettingGroup",
);
export const logoutBtn = document.getElementById("logoutBtn");

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
