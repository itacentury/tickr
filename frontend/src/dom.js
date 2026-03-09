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
export const addItemForm = document.getElementById("addItemForm");
export const addItemInput = document.getElementById("addItemInput");
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
export const newListForm = document.getElementById("newListForm");
export const newListName = document.getElementById("newListName");
export const cancelNewList = document.getElementById("cancelNewList");
export const iconPickerToggle = document.getElementById("iconPickerToggle");
export const iconOptionsContainer = document.getElementById("iconOptions");
export const iconPreview = document.getElementById("iconPreview");

// Edit List Modal
export const editListModal = document.getElementById("editListModal");
export const editListForm = document.getElementById("editListForm");
export const editListName = document.getElementById("editListName");
export const cancelEditList = document.getElementById("cancelEditList");
export const editIconPickerToggle = document.getElementById("editIconPickerToggle");
export const editIconOptionsContainer = document.getElementById("editIconOptions");
export const editIconPreview = document.getElementById("editIconPreview");
export const editListSort = document.getElementById("editListSort");

// Edit Item Modal
export const editItemModal = document.getElementById("editItemModal");
export const editItemForm = document.getElementById("editItemForm");
export const editItemText = document.getElementById("editItemText");
export const cancelEditItem = document.getElementById("cancelEditItem");
export const deleteEditItem = document.getElementById("deleteEditItem");

// Undo Toast
export const undoToast = document.getElementById("undoToast");
export const toastMessage = document.getElementById("toastMessage");
export const toastUndo = document.getElementById("toastUndo");
export const toastClose = document.getElementById("toastClose");
export const toastProgress = document.getElementById("toastProgress");

// Settings Modal
export const settingsModal = document.getElementById("settingsModal");
export const settingsBtn = document.getElementById("settingsBtn");
export const listSortSetting = document.getElementById("listSortSetting");
export const cancelSettings = document.getElementById("cancelSettings");
export const saveSettings = document.getElementById("saveSettings");
export const clearCacheBtn = document.getElementById("clearCacheBtn");

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
