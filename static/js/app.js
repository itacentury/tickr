/**
 * Todo App - Vanilla JS Frontend
 */

// State
let lists = [];
let currentListId = null;
let items = [];
let selectedIcon = "list";
let editingItemId = null;
let editSelectedIcon = "list";

// API Helper with retry logic
async function fetchWithRetry(url, options = {}, retries = 3, delay = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt === retries) {
        console.error(
          `Failed to fetch ${url} after ${retries} attempts:`,
          error
        );
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
}

// Offline cache for items
const CACHE_KEY = "tickr_items_cache";
let isOffline = false;

function saveItemsToCache(listId, itemsData) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    cache[listId] = { items: itemsData, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn("Failed to save items to cache:", e);
  }
}

function loadItemsFromCache(listId) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return cache[listId]?.items || null;
  } catch (e) {
    console.warn("Failed to load items from cache:", e);
    return null;
  }
}

function saveListsToCache(listsData) {
  try {
    localStorage.setItem(CACHE_KEY + "_lists", JSON.stringify(listsData));
  } catch (e) {
    console.warn("Failed to save lists to cache:", e);
  }
}

function loadListsFromCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY + "_lists") || "null");
  } catch (e) {
    console.warn("Failed to load lists from cache:", e);
    return null;
  }
}

async function prefetchAllItems() {
  for (const list of lists) {
    const data = await fetchWithRetry(`/api/lists/${list.id}/items`);
    if (data) {
      saveItemsToCache(list.id, data);
    }
  }
}

function updateOfflineIndicator(offline) {
  isOffline = offline;
  const indicator = document.getElementById("offlineIndicator");
  if (indicator) {
    indicator.classList.toggle("visible", offline);
  }
}

// DOM Elements
const appContainer = document.querySelector(".app");
const sidebar = document.getElementById("sidebar");
const toggleSidebar = document.getElementById("toggleSidebar");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const navList = document.getElementById("navList");
const listTitle = document.getElementById("listTitle");
const addItemForm = document.getElementById("addItemForm");
const addItemInput = document.getElementById("addItemInput");
const itemsList = document.getElementById("itemsList");
const emptyState = document.getElementById("emptyState");
const historyBtn = document.getElementById("historyBtn");
const refreshBtn = document.getElementById("refreshBtn");
const historyPanel = document.getElementById("historyPanel");
const historyList = document.getElementById("historyList");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");
const deleteListBtn = document.getElementById("deleteListBtn");
const editListBtn = document.getElementById("editListBtn");
const overlay = document.getElementById("overlay");

// New List Modal
const newListModal = document.getElementById("newListModal");
const addListBtn = document.getElementById("addListBtn");
const newListForm = document.getElementById("newListForm");
const newListName = document.getElementById("newListName");
const cancelNewList = document.getElementById("cancelNewList");
const iconOptions = document.querySelectorAll("#iconOptions .icon-option");
const iconPickerToggle = document.getElementById("iconPickerToggle");
const iconOptionsContainer = document.getElementById("iconOptions");
const iconPreview = document.getElementById("iconPreview");

// Edit List Modal
const editListModal = document.getElementById("editListModal");
const editListForm = document.getElementById("editListForm");
const editListName = document.getElementById("editListName");
const cancelEditList = document.getElementById("cancelEditList");
const editIconOptions = document.querySelectorAll(
  "#editIconOptions .icon-option"
);
const editIconPickerToggle = document.getElementById("editIconPickerToggle");
const editIconOptionsContainer = document.getElementById("editIconOptions");
const editIconPreview = document.getElementById("editIconPreview");

// Edit Item Modal
const editItemModal = document.getElementById("editItemModal");
const editItemForm = document.getElementById("editItemForm");
const editItemText = document.getElementById("editItemText");
const cancelEditItem = document.getElementById("cancelEditItem");

// Delete Confirmation Modal
const deleteConfirmModal = document.getElementById("deleteConfirmModal");
const deleteConfirmTitle = document.getElementById("deleteConfirmTitle");
const deleteConfirmMessage = document.getElementById("deleteConfirmMessage");
const cancelDelete = document.getElementById("cancelDelete");
const confirmDelete = document.getElementById("confirmDelete");
let deleteTarget = { type: null, id: null };

// Edit List Sort Select
const editListSort = document.getElementById("editListSort");

// Icons SVG map
const icons = {
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <line x1="3" y1="6" x2="3.01" y2="6"></line>
        <line x1="3" y1="12" x2="3.01" y2="12"></line>
        <line x1="3" y1="18" x2="3.01" y2="18"></line>
    </svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="9" cy="21" r="1"></circle>
        <circle cx="20" cy="21" r="1"></circle>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
    </svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 11 12 14 22 4"></polyline>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
    </svg>`,
  lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18h6"></path>
        <path d="M10 22h4"></path>
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"></path>
    </svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
    </svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
    </svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
    </svg>`,
  briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
    </svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
    </svg>`,
  film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
        <line x1="7" y1="2" x2="7" y2="22"></line>
        <line x1="17" y1="2" x2="17" y2="22"></line>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <line x1="2" y1="7" x2="7" y2="7"></line>
        <line x1="2" y1="17" x2="7" y2="17"></line>
        <line x1="17" y1="17" x2="22" y2="17"></line>
        <line x1="17" y1="7" x2="22" y2="7"></line>
    </svg>`,
  server: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
        <line x1="6" y1="6" x2="6.01" y2="6"></line>
        <line x1="6" y1="18" x2="6.01" y2="18"></line>
    </svg>`,
  disc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="3"></circle>
    </svg>`,
  shoppingBag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <path d="M16 10a4 4 0 0 1-8 0"></path>
    </svg>`,
  package: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
        <line x1="12" y1="22.08" x2="12" y2="12"></line>
    </svg>`,
  tool: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
    </svg>`,
  tv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect>
        <polyline points="17 2 12 7 7 2"></polyline>
    </svg>`,
  activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
    </svg>`,
};

/**
 * Update the icon preview in the toggle button.
 *
 * @param {HTMLElement} previewElement - The preview container element
 * @param {string} iconKey - The icon key from the icons object
 */
function updateIconPreview(previewElement, iconKey) {
  if (previewElement && icons[iconKey]) {
    previewElement.innerHTML = icons[iconKey];
  }
}

// API Functions
async function fetchLists() {
  const data = await fetchWithRetry("/api/lists");

  if (!data) {
    // Try to load from cache when offline
    const cachedLists = loadListsFromCache();
    if (cachedLists) {
      lists = cachedLists;
      updateOfflineIndicator(true);
    } else {
      lists = [];
    }
    renderNavigation();
    if (lists.length > 0 && !currentListId) {
      selectList(lists[0].id);
    }
    return;
  }

  updateOfflineIndicator(false);
  lists = data;
  saveListsToCache(data);
  renderNavigation();

  if (lists.length > 0 && !currentListId) {
    selectList(lists[0].id);
  }

  // Prefetch all items in background for offline use
  prefetchAllItems();
}

async function fetchItems(listId) {
  const data = await fetchWithRetry(`/api/lists/${listId}/items`);

  if (!data) {
    // Try to load from cache when offline
    const cachedItems = loadItemsFromCache(listId);
    if (cachedItems) {
      items = cachedItems;
      updateOfflineIndicator(true);
    } else {
      items = [];
    }
    renderItems();
    return;
  }

  updateOfflineIndicator(false);
  items = data;
  saveItemsToCache(listId, data);
  renderItems();
}

async function fetchHistory(listId) {
  const response = await fetch(`/api/lists/${listId}/history`);
  const history = await response.json();
  renderHistory(history);
}

async function createList(name, icon) {
  const response = await fetch("/api/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, icon }),
  });
  const newList = await response.json();
  await fetchLists();
  selectList(newList.id);
}

async function updateList(listId, name, icon, itemSort) {
  await fetch(`/api/lists/${listId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, icon, item_sort: itemSort }),
  });
  await fetchLists();

  // Update title and reload items if it's the current list
  if (listId === currentListId) {
    listTitle.textContent = name;
    document.title = `${name} - Todos`;
    // Reload items to apply new sorting
    await fetchItems(currentListId);
  }
}

async function deleteList(listId) {
  await fetch(`/api/lists/${listId}`, { method: "DELETE" });
  await fetchLists();

  if (lists.length > 0) {
    selectList(lists[0].id);
  } else {
    currentListId = null;
    items = [];
    renderItems();
    listTitle.textContent = "Keine Listen";
  }
}

async function createItem(text) {
  await fetch(`/api/lists/${currentListId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  await fetchItems(currentListId);
  await fetchLists();
}

async function updateItem(itemId, data) {
  await fetch(`/api/items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await fetchItems(currentListId);
  await fetchLists();

  // Refresh history if panel is open
  if (historyPanel.classList.contains("open")) {
    fetchHistory(currentListId);
  }
}

async function deleteItem(itemId) {
  await fetch(`/api/items/${itemId}`, { method: "DELETE" });
  await fetchItems(currentListId);
  await fetchLists();
}

// Helper function to update no-lists state
function updateNoListsState() {
  if (lists.length === 0) {
    appContainer.classList.add("no-lists");
  } else {
    appContainer.classList.remove("no-lists");
  }
}

// Render Functions
function renderNavigation() {
  updateNoListsState();
  navList.innerHTML = lists
    .map((list) => {
      const totalItems = list.total_items || 0;
      const completedItems = list.completed_items || 0;
      const remainingItems = totalItems - completedItems;

      return `
            <li class="nav-item">
                <button class="nav-link ${
                  list.id === currentListId ? "active" : ""
                }"
                        data-id="${list.id}">
                    <span class="nav-icon">${
                      icons[list.icon] || icons.list
                    }</span>
                    <span class="nav-text">${escapeHtml(list.name)}</span>
                    ${
                      remainingItems > 0
                        ? `<span class="nav-count">${remainingItems}</span>`
                        : ""
                    }
                </button>
            </li>
        `;
    })
    .join("");

  // Add click handlers
  navList.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      const listId = parseInt(link.dataset.id);
      selectList(listId);
      closeMobileMenu();
    });
  });
}

function renderItems() {
  if (items.length === 0) {
    itemsList.innerHTML = "";
    emptyState.classList.add("visible");

    // Update empty state text based on whether lists exist
    const emptyTitle = emptyState.querySelector("p");
    const emptySubtitle = emptyState.querySelector("span");
    if (lists.length === 0) {
      emptyTitle.textContent = "Keine Listen vorhanden";
      emptySubtitle.textContent = "Erstelle deine erste Liste";
    } else {
      emptyTitle.textContent = "Diese Liste ist leer";
      emptySubtitle.textContent = "Füge dein erstes Element hinzu";
    }
    return;
  }

  emptyState.classList.remove("visible");

  // Items are already sorted by the server according to settings
  itemsList.innerHTML = items
    .map(
      (item) => `
        <li class="item" data-id="${item.id}">
            <label class="item-checkbox">
                <input type="checkbox" ${item.completed ? "checked" : ""}>
                <span class="checkmark">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </span>
            </label>
            <div class="item-content">
                <span class="item-text">${escapeHtml(item.text)}</span>
            </div>
            <div class="item-actions">
                <button class="item-edit-btn" title="Bearbeiten">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="item-delete-btn" title="Löschen">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </li>
    `
    )
    .join("");

  // Add event handlers
  itemsList.querySelectorAll(".item").forEach((itemEl) => {
    const itemId = parseInt(itemEl.dataset.id);
    const item = items.find((i) => i.id === itemId);

    const checkbox = itemEl.querySelector('input[type="checkbox"]');
    checkbox.addEventListener("change", () => {
      updateItem(itemId, { completed: checkbox.checked });
    });

    const editBtn = itemEl.querySelector(".item-edit-btn");
    editBtn.addEventListener("click", () => {
      openEditItemModal(itemId, item.text);
    });

    const deleteBtn = itemEl.querySelector(".item-delete-btn");
    deleteBtn.addEventListener("click", () => {
      openDeleteConfirmModal("item", itemId, item.text);
    });
  });
}

function renderHistory(history) {
  if (history.length === 0) {
    historyList.innerHTML =
      '<li class="history-empty">Noch keine Aktivitäten</li>';
    return;
  }

  const actionLabels = {
    item_created: { text: "Hinzugefügt", class: "created" },
    item_completed: { text: "Erledigt", class: "completed" },
    item_uncompleted: { text: "Wieder geöffnet", class: "uncompleted" },
    item_deleted: { text: "Gelöscht", class: "deleted" },
    item_edited: { text: "Bearbeitet", class: "edited" },
    list_created: { text: "Liste erstellt", class: "created" },
  };

  historyList.innerHTML = history
    .map((entry) => {
      const action = actionLabels[entry.action] || {
        text: entry.action,
        class: "",
      };

      // Show restore button for completed items that still exist and are still completed
      const showRestoreBtn =
        entry.action === "item_completed" &&
        entry.item_id &&
        entry.item_current_completed === 1;

      return `
            <li class="history-item">
                <div class="history-item-content">
                    <div class="history-action">
                        <span class="action-type ${action.class}">${
        action.text
      }</span>
                    </div>
                    <div class="history-text">${escapeHtml(
                      entry.item_text || ""
                    )}</div>
                    <div class="history-time">${formatDateTime(
                      entry.timestamp
                    )}</div>
                    ${
                      showRestoreBtn
                        ? `
                        <div class="history-actions">
                            <button class="history-restore-btn" data-item-id="${entry.item_id}">
                                Wieder öffnen
                            </button>
                        </div>
                    `
                        : ""
                    }
                </div>
            </li>
        `;
    })
    .join("");

  // Add restore button handlers
  historyList.querySelectorAll(".history-restore-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = parseInt(btn.dataset.itemId);
      await updateItem(itemId, { completed: false });
    });
  });
}

// Helper Functions
function selectList(listId) {
  currentListId = listId;
  const list = lists.find((l) => l.id === listId);
  if (list) {
    listTitle.textContent = list.name;
    document.title = `${list.name} - Todos`;
  }

  // Update active state in navigation
  navList.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", parseInt(link.dataset.id) === listId);
  });

  fetchItems(listId);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now - date;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "heute";
  } else if (diffDays === 1) {
    return "gestern";
  } else if (diffDays < 7) {
    return `vor ${diffDays} Tagen`;
  } else {
    return date.toLocaleDateString("de-DE");
  }
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function closeMobileMenu() {
  sidebar.classList.remove("mobile-open");
  overlay.classList.remove("visible");
}

function openMobileMenu() {
  sidebar.classList.add("mobile-open");
  overlay.classList.add("visible");
}

function openEditListModal() {
  const list = lists.find((l) => l.id === currentListId);
  if (!list) return;

  editListName.value = list.name;
  editSelectedIcon = list.icon || "list";
  editListSort.value = list.item_sort || "alphabetical";

  updateIconPreview(editIconPreview, editSelectedIcon);
  editIconOptions.forEach((opt) => {
    opt.classList.toggle("selected", opt.dataset.icon === editSelectedIcon);
  });

  // Reset icon picker to collapsed state
  editIconPickerToggle.classList.remove("open");
  editIconOptionsContainer.classList.remove("expanded");

  editListModal.classList.add("open");
  setTimeout(() => editListName.focus(), 100);
}

function openEditItemModal(itemId, text) {
  editingItemId = itemId;
  editItemText.value = text;
  editItemModal.classList.add("open");
  setTimeout(() => {
    editItemText.focus();
    editItemText.select();
  }, 100);
}

/**
 * Opens the delete confirmation modal for a list or item.
 */
function openDeleteConfirmModal(type, id, name) {
  deleteTarget = { type, id };

  if (type === "list") {
    deleteConfirmTitle.textContent = "Liste löschen";
    deleteConfirmMessage.textContent = `Möchtest du die Liste "${name}" wirklich löschen? Alle Einträge in dieser Liste werden ebenfalls gelöscht.`;
  } else {
    deleteConfirmTitle.textContent = "Eintrag löschen";
    deleteConfirmMessage.textContent = `Möchtest du den Eintrag "${name}" wirklich löschen?`;
  }

  deleteConfirmModal.classList.add("open");
  setTimeout(() => confirmDelete.focus(), 100);
}

/**
 * Closes the delete confirmation modal and resets the target.
 */
function closeDeleteConfirmModal() {
  deleteConfirmModal.classList.remove("open");
  deleteTarget = { type: null, id: null };
}

// Event Listeners

// Sidebar toggle (desktop)
toggleSidebar.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
  localStorage.setItem(
    "sidebarCollapsed",
    sidebar.classList.contains("collapsed")
  );
});

// Mobile menu button
mobileMenuBtn.addEventListener("click", openMobileMenu);

// Overlay click (close mobile menu / history)
overlay.addEventListener("click", () => {
  closeMobileMenu();
  historyPanel.classList.remove("open");
  overlay.classList.remove("visible");
});

// Icon picker toggle for new list modal
iconPickerToggle.addEventListener("click", () => {
  iconPickerToggle.classList.toggle("open");
  iconOptionsContainer.classList.toggle("expanded");
});

// Icon picker toggle for edit list modal
editIconPickerToggle.addEventListener("click", () => {
  editIconPickerToggle.classList.toggle("open");
  editIconOptionsContainer.classList.toggle("expanded");
});

// Add item form
addItemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = addItemInput.value.trim();
  if (text && currentListId) {
    await createItem(text);
    addItemInput.value = "";
  }
});

// History button
historyBtn.addEventListener("click", () => {
  if (currentListId) {
    fetchHistory(currentListId);
    historyPanel.classList.add("open");
    overlay.classList.add("visible");
  }
});

// Refresh button
refreshBtn.addEventListener("click", async () => {
  if (currentListId) {
    await fetchLists();
    await fetchItems(currentListId);
  }
});

// Close history button
closeHistoryBtn.addEventListener("click", () => {
  historyPanel.classList.remove("open");
  overlay.classList.remove("visible");
});

// Edit list button
editListBtn.addEventListener("click", openEditListModal);

// Delete list button
deleteListBtn.addEventListener("click", () => {
  if (currentListId && lists.length > 0) {
    const list = lists.find((l) => l.id === currentListId);
    openDeleteConfirmModal("list", currentListId, list.name);
  }
});

// Add list button
addListBtn.addEventListener("click", () => {
  newListModal.classList.add("open");
  newListName.value = "";
  selectedIcon = "list";
  updateIconPreview(iconPreview, selectedIcon);
  iconOptions.forEach((opt) => {
    opt.classList.toggle("selected", opt.dataset.icon === selectedIcon);
  });
  // Reset icon picker to collapsed state
  iconPickerToggle.classList.remove("open");
  iconOptionsContainer.classList.remove("expanded");
  setTimeout(() => newListName.focus(), 100);
});

// Icon selection (new list)
iconOptions.forEach((option) => {
  option.addEventListener("click", () => {
    selectedIcon = option.dataset.icon;
    updateIconPreview(iconPreview, selectedIcon);
    iconOptions.forEach((opt) => {
      opt.classList.toggle("selected", opt.dataset.icon === selectedIcon);
    });
  });
});

// Icon selection (edit list)
editIconOptions.forEach((option) => {
  option.addEventListener("click", () => {
    editSelectedIcon = option.dataset.icon;
    updateIconPreview(editIconPreview, editSelectedIcon);
    editIconOptions.forEach((opt) => {
      opt.classList.toggle("selected", opt.dataset.icon === editSelectedIcon);
    });
  });
});

// New list form
newListForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = newListName.value.trim();
  if (name) {
    await createList(name, selectedIcon);
    newListModal.classList.remove("open");
  }
});

// Cancel new list
cancelNewList.addEventListener("click", () => {
  newListModal.classList.remove("open");
});

// Edit list form
editListForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = editListName.value.trim();
  if (name && currentListId) {
    await updateList(currentListId, name, editSelectedIcon, editListSort.value);
    editListModal.classList.remove("open");
  }
});

// Cancel edit list
cancelEditList.addEventListener("click", () => {
  editListModal.classList.remove("open");
});

// Edit item form
editItemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = editItemText.value.trim();
  if (text && editingItemId) {
    await updateItem(editingItemId, { text });
    editItemModal.classList.remove("open");
    editingItemId = null;
  }
});

// Cancel edit item
cancelEditItem.addEventListener("click", () => {
  editItemModal.classList.remove("open");
  editingItemId = null;
});

// Cancel delete
cancelDelete.addEventListener("click", closeDeleteConfirmModal);

// Confirm delete
confirmDelete.addEventListener("click", async () => {
  if (deleteTarget.type === "list") {
    await deleteList(deleteTarget.id);
  } else if (deleteTarget.type === "item") {
    await deleteItem(deleteTarget.id);
  }
  closeDeleteConfirmModal();
});

// Close modals on background click
newListModal.addEventListener("click", (e) => {
  if (e.target === newListModal) {
    newListModal.classList.remove("open");
  }
});

editListModal.addEventListener("click", (e) => {
  if (e.target === editListModal) {
    editListModal.classList.remove("open");
  }
});

editItemModal.addEventListener("click", (e) => {
  if (e.target === editItemModal) {
    editItemModal.classList.remove("open");
    editingItemId = null;
  }
});

deleteConfirmModal.addEventListener("click", (e) => {
  if (e.target === deleteConfirmModal) {
    closeDeleteConfirmModal();
  }
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Escape to close modals/panels
  if (e.key === "Escape") {
    newListModal.classList.remove("open");
    editListModal.classList.remove("open");
    editItemModal.classList.remove("open");
    editingItemId = null;
    closeDeleteConfirmModal();
    historyPanel.classList.remove("open");
    overlay.classList.remove("visible");
    closeMobileMenu();
  }

  // Ctrl/Cmd + N to add new item (when not in input)
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key === "n" &&
    document.activeElement !== addItemInput &&
    document.activeElement !== newListName &&
    document.activeElement !== editListName &&
    document.activeElement !== editItemText
  ) {
    e.preventDefault();
    addItemInput.focus();
  }
});

// Restore sidebar state
if (localStorage.getItem("sidebarCollapsed") === "true") {
  sidebar.classList.add("collapsed");
}

// Touch swipe navigation for mobile
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

const mainContent = document.querySelector(".main-content");

mainContent.addEventListener(
  "touchstart",
  (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  },
  { passive: true }
);

mainContent.addEventListener(
  "touchend",
  (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
  },
  { passive: true }
);

function handleSwipe() {
  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;
  const minSwipeDistance = 80;

  // Only trigger if horizontal swipe is dominant (more X than Y movement)
  if (
    Math.abs(deltaX) < minSwipeDistance ||
    Math.abs(deltaX) < Math.abs(deltaY)
  ) {
    return;
  }

  // Find current list index
  const currentIndex = lists.findIndex((l) => l.id === currentListId);
  if (currentIndex === -1) return;

  // Determine direction and target list
  let targetListId;
  const swipeLeft = deltaX < 0;

  if (swipeLeft) {
    // Swipe left → next list
    const nextIndex = currentIndex + 1;
    targetListId = nextIndex < lists.length ? lists[nextIndex].id : lists[0].id;
  } else {
    // Swipe right → previous list
    const prevIndex = currentIndex - 1;
    targetListId =
      prevIndex >= 0 ? lists[prevIndex].id : lists[lists.length - 1].id;
  }

  // Animate the transition
  const outClass = swipeLeft ? "swipe-out-left" : "swipe-out-right";
  const inClass = swipeLeft ? "swipe-in-left" : "swipe-in-right";

  itemsList.classList.add(outClass);
  listTitle.classList.add("fade-out");

  setTimeout(() => {
    itemsList.classList.remove(outClass);
    listTitle.classList.remove("fade-out");
    selectList(targetListId);
    itemsList.classList.add(inClass);
    listTitle.classList.add("fade-in");

    setTimeout(() => {
      itemsList.classList.remove(inClass);
      listTitle.classList.remove("fade-in");
    }, 150);
  }, 150);
}

// Initialize
fetchLists();

// Online/Offline detection
window.addEventListener("online", () => {
  updateOfflineIndicator(false);
  fetchLists(); // Refresh data when back online
});

window.addEventListener("offline", () => {
  updateOfflineIndicator(true);
});

// Register Service Worker with update detection
if ("serviceWorker" in navigator) {
  let refreshing = false;

  // Reload page when new service worker takes control
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("Service Worker registered");

        // Check for updates every 60 seconds
        setInterval(() => {
          reg.update();
        }, 60000);

        // Handle waiting service worker
        if (reg.waiting) {
          showUpdateNotification(reg.waiting);
        }

        // Handle installing service worker
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New service worker available
              showUpdateNotification(newWorker);
            }
          });
        });
      })
      .catch((err) => console.log("Service Worker registration failed:", err));
  });

  /**
   * Show update notification to user.
   *
   * @param {ServiceWorker} worker - The waiting service worker
   */
  function showUpdateNotification(worker) {
    const notification = document.createElement("div");
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #4a5568;
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 16px;
      font-family: system-ui, -apple-system, sans-serif;
      animation: slideUp 0.3s ease-out;
    `;

    notification.innerHTML = `
      <span>New version available!</span>
      <button id="update-btn" style="
        background: #48bb78;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 600;
      ">Update</button>
      <button id="dismiss-btn" style="
        background: transparent;
        color: white;
        border: 1px solid white;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
      ">Later</button>
    `;

    // Add animation keyframes
    if (!document.querySelector("#sw-update-styles")) {
      const style = document.createElement("style");
      style.id = "sw-update-styles";
      style.textContent = `
        @keyframes slideUp {
          from {
            transform: translateX(-50%) translateY(100px);
            opacity: 0;
          }
          to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    // Update button handler
    document.getElementById("update-btn").addEventListener("click", () => {
      worker.postMessage({ type: "SKIP_WAITING" });
      notification.remove();
    });

    // Dismiss button handler
    document.getElementById("dismiss-btn").addEventListener("click", () => {
      notification.remove();
    });
  }
}
