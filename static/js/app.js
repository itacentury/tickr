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
let appSettings = {
  list_sort: "alphabetical"
};

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
          error,
        );
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
}

// API Helper for write operations (POST, PUT, DELETE) with retry logic
async function fetchWriteWithRetry(
  url,
  options = {},
  retries = 2,
  delay = 500,
) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      // Return JSON if there's content, otherwise return true for success
      const text = await response.text();
      return text ? JSON.parse(text) : true;
    } catch (error) {
      if (attempt === retries) {
        console.error(
          `Failed to write ${url} after ${retries} attempts:`,
          error,
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
let currentFetchController = null;
let offlineCheckVersion = 0;

// Check if server is reachable (with short timeout)
async function checkServerReachable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch("/api/settings", {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

function saveItemsToCache(listId, itemsData) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    cache[listId] = {
      items: itemsData,
      timestamp: Date.now()
    };
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

let prefetchTimeout = null;

/**
 * Prefetch items for all lists in background for offline use.
 * Debounced to avoid redundant request bursts.
 */
function prefetchAllItems() {
  if (prefetchTimeout) clearTimeout(prefetchTimeout);
  prefetchTimeout = setTimeout(async () => {
    for (const list of lists) {
      const data = await fetchWithRetry(`/api/lists/${list.id}/items`);
      if (data) {
        saveItemsToCache(list.id, data);
      }
    }
  }, 3000);
}

async function updateOfflineIndicator(offline) {
  const indicator = document.getElementById("offlineIndicator");
  const version = ++offlineCheckVersion;

  if (!offline) {
    // Server responded successfully - we're online
    isOffline = false;
    if (indicator) {
      indicator.classList.remove("visible");
    }
    return;
  }

  // API request failed - check if server is actually unreachable
  const serverReachable = await checkServerReachable();

  // Ignore stale result if a newer call has already resolved
  if (version !== offlineCheckVersion) return;

  isOffline = !serverReachable;

  if (indicator) {
    indicator.classList.toggle("visible", isOffline);
  }
}

// DOM Elements
const appContainer = document.querySelector(".app");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
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
const iconPickerToggle = document.getElementById("iconPickerToggle");
const iconOptionsContainer = document.getElementById("iconOptions");
const iconPreview = document.getElementById("iconPreview");

// Edit List Modal
const editListModal = document.getElementById("editListModal");
const editListForm = document.getElementById("editListForm");
const editListName = document.getElementById("editListName");
const cancelEditList = document.getElementById("cancelEditList");
const editIconPickerToggle = document.getElementById("editIconPickerToggle");
const editIconOptionsContainer = document.getElementById("editIconOptions");
const editIconPreview = document.getElementById("editIconPreview");

// Edit Item Modal
const editItemModal = document.getElementById("editItemModal");
const editItemForm = document.getElementById("editItemForm");
const editItemText = document.getElementById("editItemText");
const cancelEditItem = document.getElementById("cancelEditItem");
const deleteEditItem = document.getElementById("deleteEditItem");

// Edit List Sort Select
const editListSort = document.getElementById("editListSort");

// Undo Toast
const undoToast = document.getElementById("undoToast");
const toastMessage = document.getElementById("toastMessage");
const toastUndo = document.getElementById("toastUndo");
const toastClose = document.getElementById("toastClose");
const toastProgress = document.getElementById("toastProgress");
let toastTimeout = null;
let toastUndoCallback = null;
let toastStartTime = null;
let toastRemainingTime = 5000;

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
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
    </svg>`,
  music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18V5l12-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="16" r="3"></circle>
    </svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
        <circle cx="12" cy="13" r="4"></circle>
    </svg>`,
  gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 12 20 22 4 22 4 12"></polyline>
        <rect x="2" y="7" width="20" height="5"></rect>
        <line x1="12" y1="22" x2="12" y2="7"></line>
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
    </svg>`,
  plane: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"></path>
    </svg>`,
  coffee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
        <line x1="6" y1="1" x2="6" y2="4"></line>
        <line x1="10" y1="1" x2="10" y2="4"></line>
        <line x1="14" y1="1" x2="14" y2="4"></line>
    </svg>`,
  gamepad: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="6" y1="12" x2="10" y2="12"></line>
        <line x1="8" y1="10" x2="8" y2="14"></line>
        <line x1="15" y1="13" x2="15.01" y2="13"></line>
        <line x1="18" y1="11" x2="18.01" y2="11"></line>
        <rect x="2" y="6" width="20" height="12" rx="2"></rect>
    </svg>`,
  graduation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
        <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
    </svg>`,
  dumbbell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6.5 6.5a2.12 2.12 0 0 1 3 3L12 12l2.5-2.5a2.12 2.12 0 1 1 3 3L15 15l2.5 2.5a2.12 2.12 0 0 1-3 3L12 18l-2.5 2.5a2.12 2.12 0 1 1-3-3L9 15l-2.5-2.5a2.12 2.12 0 0 1 3-3L12 12"></path>
    </svg>`,
  palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"></circle>
        <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"></circle>
        <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"></circle>
        <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"></circle>
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c0.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"></path>
    </svg>`,
  utensils: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"></path>
        <path d="M7 2v20"></path>
        <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"></path>
    </svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
        <polyline points="22,6 12,13 2,6"></polyline>
    </svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
    </svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>`,
  headphones: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
    </svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
    </svg>`,
  mapPin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
        <circle cx="12" cy="10" r="3"></circle>
    </svg>`,
  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
    </svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>`,
  zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
    </svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
    </svg>`,
  flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
        <line x1="4" y1="22" x2="4" y2="15"></line>
    </svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    </svg>`,
  compass: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
    </svg>`,
  smile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
        <line x1="9" y1="9" x2="9.01" y2="9"></line>
        <line x1="15" y1="9" x2="15.01" y2="9"></line>
    </svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="6"></circle>
        <circle cx="12" cy="12" r="2"></circle>
    </svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </svg>`,
};

/** Display labels for each icon key. */
const iconLabels = {
  list: "List",
  cart: "Shopping",
  check: "Tasks",
  lightbulb: "Ideas",
  star: "Important",
  heart: "Favorites",
  home: "Home",
  briefcase: "Work",
  book: "Books",
  film: "Film",
  server: "Server",
  disc: "Vinyl",
  shoppingBag: "Shopping Bag",
  package: "Package",
  tool: "Household",
  tv: "Media",
  activity: "Activity",
  calendar: "Calendar",
  clock: "Clock",
  music: "Music",
  camera: "Camera",
  gift: "Gift",
  plane: "Travel",
  coffee: "Coffee",
  gamepad: "Gaming",
  graduation: "Education",
  dumbbell: "Fitness",
  palette: "Art",
  utensils: "Food",
  mail: "Mail",
  phone: "Phone",
  globe: "World",
  headphones: "Podcasts",
  key: "Security",
  mapPin: "Places",
  pencil: "Notes",
  users: "People",
  zap: "Priority",
  cloud: "Cloud",
  flag: "Goals",
  bell: "Reminders",
  compass: "Explore",
  smile: "Mood",
  target: "Focus",
  sun: "Outdoors",
};

/**
 * Populate an icon picker container with icon option buttons.
 *
 * @param {HTMLElement} container - The container element to fill
 */
function populateIconPicker(container) {
  container.innerHTML = "";
  for (const [key, svg] of Object.entries(icons)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-option";
    btn.dataset.icon = key;
    btn.title = iconLabels[key] || key;
    btn.innerHTML = svg;
    container.appendChild(btn);
  }
}

populateIconPicker(iconOptionsContainer);
populateIconPicker(editIconOptionsContainer);

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
async function fetchSettings() {
  const data = await fetchWithRetry("/api/settings");
  if (data) {
    appSettings = data;
  }
}

async function updateSettings(settings) {
  console.log("updateSettings called with:", settings);
  const result = await fetchWriteWithRetry("/api/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(settings),
  });
  console.log("API result:", result);

  if (!result) {
    console.warn("Failed to update settings");
    return false;
  }

  // Update local state and refresh lists
  Object.assign(appSettings, settings);
  console.log("appSettings updated:", appSettings);
  await fetchLists();
  console.log("Lists refreshed");
  return true;
}

async function reorderLists(listIds) {
  const result = await fetchWriteWithRetry("/api/lists/reorder", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      list_ids: listIds
    }),
  });

  if (!result) {
    console.warn("Failed to reorder lists");
    return false;
  }

  return true;
}

/**
 * Determine which list to select based on saved preference.
 * Falls back to first list if saved list no longer exists.
 */
function getInitialListId() {
  const savedId = parseInt(localStorage.getItem("tickr_current_list"));
  if (savedId && lists.some((l) => l.id === savedId)) {
    return savedId;
  }
  return lists.length > 0 ? lists[0].id : null;
}

/**
 * Find the neighboring list to select after deletion.
 * Prefers next list, falls back to previous list.
 */
function getNeighborListId(deletedListId, oldLists) {
  const index = oldLists.findIndex((l) => l.id === deletedListId);
  if (index === -1) return lists.length > 0 ? lists[0].id : null;

  // Try next list first (same index in new array), then previous
  if (index < lists.length) {
    return lists[index].id;
  }
  if (lists.length > 0) {
    return lists[lists.length - 1].id;
  }
  return null;
}

async function fetchLists() {
  // Save current lists to find neighbor if current list was deleted
  const oldLists = [...lists];

  // Immediately show cached lists (cache-first)
  const cachedLists = loadListsFromCache();
  if (cachedLists) {
    lists = cachedLists;
    renderNavigation();
    if (lists.length > 0 && !currentListId) {
      selectList(getInitialListId());
    }
  }

  // Then try to fetch fresh data
  try {
    const response = await fetch("/api/lists", {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    lists = data;
    saveListsToCache(data);
    renderNavigation();
    updateOfflineIndicator(false);

    // Handle case where current list was deleted on another device
    if (currentListId && !lists.some((l) => l.id === currentListId)) {
      const neighborId = getNeighborListId(currentListId, oldLists);
      if (neighborId) {
        selectList(neighborId);
      } else {
        currentListId = null;
        localStorage.removeItem("tickr_current_list");
        items = [];
        renderItems();
        listTitle.textContent = "No Lists";
        document.title = "Tickr";
      }
    } else if (lists.length > 0 && !currentListId) {
      selectList(getInitialListId());
    }

    // Prefetch all items in background for offline use
    prefetchAllItems();
  } catch {
    // Fetch failed - we're already showing cached lists
    if (!cachedLists || cachedLists.length === 0) {
      lists = [];
      renderNavigation();
    }
    updateOfflineIndicator(true);
  }
}

async function fetchItems(listId) {
  // Cancel any pending fetch for a different list
  if (currentFetchController) {
    currentFetchController.abort();
  }

  // Immediately show cached items (cache-first)
  const cachedItems = loadItemsFromCache(listId);
  if (cachedItems) {
    items = cachedItems;
    renderItems();
  } else {
    items = [];
    renderItems();
  }

  // Then try to fetch fresh data in background
  const controller = new AbortController();
  currentFetchController = controller;

  try {
    const response = await fetch(`/api/lists/${listId}/items`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Only update if this is still the current list
    if (currentListId === listId) {
      items = data;
      saveItemsToCache(listId, data);
      renderItems();
      updateOfflineIndicator(false);
    }
  } catch (error) {
    if (error.name === "AbortError") {
      // Request was cancelled due to list switch - ignore
      return;
    }
    // Fetch failed - we're already showing cached items
    // Update offline indicator
    if (currentListId === listId) {
      updateOfflineIndicator(true);
    }
  }
}

async function fetchHistory(listId) {
  const response = await fetch(`/api/lists/${listId}/history`, {
    cache: "no-store",
  });
  const history = await response.json();
  renderHistory(history);
}

async function createList(name, icon) {
  const newList = await fetchWriteWithRetry("/api/lists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      icon
    }),
  });

  if (!newList) {
    console.warn("Failed to create list");
    return;
  }

  await fetchLists();
  selectList(newList.id);
}

async function updateList(listId, name, icon, itemSort) {
  const result = await fetchWriteWithRetry(`/api/lists/${listId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      icon,
      item_sort: itemSort
    }),
  });

  if (!result) {
    console.warn("Failed to update list, will retry on next sync");
    return;
  }

  await fetchLists();

  // Update title and reload items if it's the current list
  if (listId === currentListId) {
    listTitle.textContent = name;
    document.title = `${name} - Tickr`;
    // Reload items to apply new sorting
    await fetchItems(currentListId);
  }
}

async function deleteList(listId) {
  // Save old lists to find neighbor after deletion
  const oldLists = [...lists];

  const result = await fetchWriteWithRetry(`/api/lists/${listId}`, {
    method: "DELETE",
  });

  if (!result) {
    console.warn("Failed to delete list");
    return;
  }

  await fetchLists();

  const neighborId = getNeighborListId(listId, oldLists);
  if (neighborId) {
    selectList(neighborId);
  } else {
    currentListId = null;
    localStorage.removeItem("tickr_current_list");
    items = [];
    renderItems();
    listTitle.textContent = "No Lists";
  }
}

async function createItem(listIdOrText, text, undo = false) {
  // Support both createItem(text) and createItem(listId, text, undo)
  let listId, itemText, isUndo;
  if (typeof text === "string") {
    listId = listIdOrText;
    itemText = text;
    isUndo = undo;
  } else if (typeof text === "boolean") {
    // createItem(text, undo) format
    listId = currentListId;
    itemText = listIdOrText;
    isUndo = text;
  } else {
    listId = currentListId;
    itemText = listIdOrText;
    isUndo = false;
  }

  const result = await fetchWriteWithRetry(`/api/lists/${listId}/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: itemText,
      undo: isUndo
    }),
  });

  if (!result) {
    console.warn("Failed to create item");
    return;
  }

  await fetchItems(currentListId);
  await fetchLists();

  // Refresh history if panel is open
  if (historyPanel.classList.contains("open")) {
    await fetchHistory(currentListId);
  }
}

async function updateItem(itemId, data) {
  const result = await fetchWriteWithRetry(`/api/items/${itemId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data),
  });

  if (!result) {
    console.warn("Failed to update item");
    return;
  }

  await fetchItems(currentListId);
  await fetchLists();

  // Refresh history if panel is open
  if (historyPanel.classList.contains("open")) {
    await fetchHistory(currentListId);
  }
}

async function deleteItem(itemId, undo = false) {
  const url = undo ? `/api/items/${itemId}?undo=true` : `/api/items/${itemId}`;
  const result = await fetchWriteWithRetry(url, {
    method: "DELETE",
  });

  if (!result) {
    console.warn("Failed to delete item");
    return;
  }

  await fetchItems(currentListId);
  await fetchLists();

  // Refresh history if panel is open
  if (historyPanel.classList.contains("open")) {
    await fetchHistory(currentListId);
  }
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
  const isCustomSort = appSettings.list_sort === "custom";

  navList.innerHTML = lists
    .map((list) => {
      const totalItems = list.total_items || 0;
      const completedItems = list.completed_items || 0;
      const remainingItems = totalItems - completedItems;

      return `
            <li class="nav-item" data-list-id="${list.id}" ${
              isCustomSort ? 'draggable="true"' : ""
            }>
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

  // Add drag & drop handlers if custom sort is enabled
  if (isCustomSort) {
    setupDragAndDrop();
  }
}

let draggedItem = null;

function setupDragAndDrop() {
  const navItems = navList.querySelectorAll(".nav-item");

  navItems.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragend", handleDragEnd);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("dragenter", handleDragEnter);
    item.addEventListener("dragleave", handleDragLeave);
    item.addEventListener("drop", handleDrop);
  });
}

function handleDragStart(e) {
  draggedItem = this;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", this.dataset.listId);
}

function handleDragEnd() {
  this.classList.remove("dragging");
  navList.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("drag-over");
  });
  draggedItem = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleDragEnter(e) {
  e.preventDefault();
  if (this !== draggedItem) {
    this.classList.add("drag-over");
  }
}

function handleDragLeave() {
  this.classList.remove("drag-over");
}

async function handleDrop(e) {
  e.preventDefault();
  this.classList.remove("drag-over");

  if (this === draggedItem) {
    return;
  }

  // Get new order
  const navItems = Array.from(navList.querySelectorAll(".nav-item"));
  const draggedIndex = navItems.indexOf(draggedItem);
  const dropIndex = navItems.indexOf(this);

  // Move the dragged item in the DOM
  if (draggedIndex < dropIndex) {
    this.parentNode.insertBefore(draggedItem, this.nextSibling);
  } else {
    this.parentNode.insertBefore(draggedItem, this);
  }

  // Get new list order
  const newOrder = Array.from(navList.querySelectorAll(".nav-item")).map(
    (item) => parseInt(item.dataset.listId),
  );

  // Save to server
  await reorderLists(newOrder);

  // Refresh to get updated sort_order values
  await fetchLists();
}

function renderItems() {
  if (items.length === 0) {
    itemsList.innerHTML = "";
    emptyState.classList.add("visible");

    // Update empty state text based on whether lists exist
    const emptyTitle = emptyState.querySelector("p");
    const emptySubtitle = emptyState.querySelector("span");
    if (lists.length === 0) {
      emptyTitle.textContent = "No lists available";
      emptySubtitle.textContent = "Create your first list";
    } else {
      emptyTitle.textContent = "This list is empty";
      emptySubtitle.textContent = "Add your first item";
    }
    return;
  }

  emptyState.classList.remove("visible");

  // Items are already sorted by the server according to settings
  itemsList.innerHTML = items
    .map(
      (item, index) => `
        <li class="item${item.completed ? " completed" : ""}" data-id="${item.id}" style="--i:${index}">
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
        </li>
    `,
    )
    .join("");

  // Add event handlers
  itemsList.querySelectorAll(".item").forEach((itemEl) => {
    const itemId = parseInt(itemEl.dataset.id);
    const item = items.find((i) => i.id === itemId);

    const checkbox = itemEl.querySelector('input[type="checkbox"]');
    checkbox.addEventListener("change", async () => {
      const isCompleted = checkbox.checked;
      const itemText = item.text;
      await updateItem(itemId, {
        completed: isCompleted
      });

      if (isCompleted) {
        showUndoToast(`"${itemText}" completed`, async () => {
          await updateItem(itemId, {
            completed: false,
            undo: true
          });
        });
      }
    });

    // Click anywhere on item opens edit modal (except checkbox)
    itemEl.addEventListener("click", (e) => {
      if (!e.target.closest(".item-checkbox")) {
        openEditItemModal(itemId, item.text);
      }
    });
  });
}

function renderHistory(history) {
  if (history.length === 0) {
    historyList.innerHTML = '<li class="history-empty">No activities yet</li>';
    return;
  }

  const actionLabels = {
    item_created: {
      text: "Added",
      class: "created"
    },
    item_completed: {
      text: "Completed",
      class: "completed"
    },
    item_uncompleted: {
      text: "Reopened",
      class: "uncompleted"
    },
    item_deleted: {
      text: "Deleted",
      class: "deleted"
    },
    item_edited: {
      text: "Edited",
      class: "edited"
    },
    list_created: {
      text: "List created",
      class: "created"
    },
  };

  /**
   * Return a date group label for a timestamp.
   *
   * @param {string} timestamp - ISO timestamp string
   * @returns {string} "Today", "Yesterday", or a localized date string
   */
  function getDateGroup(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const entryDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((today - entryDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
  }

  /**
   * Format a timestamp to a short time string (hours and minutes).
   *
   * @param {string} timestamp - ISO timestamp string
   * @returns {string} Formatted time like "14:30"
   */
  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  // Group entries by date
  const groups = [];
  let currentGroup = null;

  for (const entry of history) {
    const label = getDateGroup(entry.timestamp);
    if (!currentGroup || currentGroup.label !== label) {
      currentGroup = {
        label,
        entries: []
      };
      groups.push(currentGroup);
    }
    currentGroup.entries.push(entry);
  }

  historyList.innerHTML = groups
    .map((group) => {
      const entries = group.entries
        .map((entry) => {
          const action = actionLabels[entry.action] || {
            text: entry.action,
            class: ""
          };
          const itemText = entry.item_text || "";
          const displayText = entry.action === "item_edited" && itemText.includes(" → ") ?
            itemText.split(" → ")[1] :
            itemText;

          return `<li class="history-entry">
            <span class="history-time">${formatTime(entry.timestamp)}</span>
            <span class="action-type ${action.class}">${action.text}</span>
            <span class="history-text">${escapeHtml(displayText)}</span>
          </li>`;
        })
        .join("");

      return `<li class="history-group">
        <div class="history-date-header">${group.label}</div>
        <ul class="history-entries">${entries}</ul>
      </li>`;
    })
    .join("");
}

// Helper Functions
function selectList(listId) {
  currentListId = listId;
  // Persist selected list for page refreshes
  localStorage.setItem("tickr_current_list", listId);

  const list = lists.find((l) => l.id === listId);
  if (list) {
    listTitle.textContent = list.name;
    document.title = `${list.name} - Tickr`;
    // Update header icon
    const listTitleIcon = document.getElementById("listTitleIcon");
    if (listTitleIcon) {
      listTitleIcon.innerHTML = icons[list.icon] || icons.list;
    }
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
    return "today";
  } else if (diffDays === 1) {
    return "yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString("en-US");
  }
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Show an undo toast, immediately replacing any currently visible toast.
 */
function showUndoToast(message, undoCallback) {
  presentToast(message, undoCallback);
}

/**
 * Present a toast notification immediately with a 5-second countdown.
 * If a toast is already visible, the message crossfades smoothly.
 */
function presentToast(message, undoCallback) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }

  toastUndoCallback = undoCallback;
  toastRemainingTime = 5000;
  toastStartTime = Date.now();

  const isVisible = undoToast.classList.contains("visible");

  function startCountdown() {
    // Reset and animate progress bar
    toastProgress.style.opacity = "1";
    toastProgress.style.transition = "none";
    toastProgress.style.transform = "scaleX(1)";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toastProgress.style.transition = `transform ${toastRemainingTime}ms linear`;
        toastProgress.style.transform = "scaleX(0)";
      });
    });

    toastTimeout = setTimeout(() => {
      hideUndoToast();
    }, toastRemainingTime);
  }

  if (isVisible) {
    // Fade out message, swap text, fade back in
    toastMessage.classList.add("swapping");
    setTimeout(() => {
      toastMessage.textContent = message;
      toastMessage.classList.remove("swapping");
      startCountdown();
    }, 150);
  } else {
    toastMessage.textContent = message;
    undoToast.classList.add("visible");
    startCountdown();
  }
}

/**
 * Hide the current toast.
 */
function hideUndoToast() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toastUndoCallback = null;
  undoToast.classList.remove("visible");
}

/**
 * Pause the toast timer on hover and hide the progress bar.
 */
function pauseToast() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toastProgress.style.opacity = "0";
}

/**
 * Restart the toast timer after hover ends and show the progress bar.
 */
function resumeToast() {
  if (!undoToast.classList.contains("visible")) return;

  toastRemainingTime = 5000;
  toastStartTime = Date.now();

  toastProgress.style.opacity = "1";
  toastProgress.style.transition = "none";
  toastProgress.style.transform = "scaleX(1)";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toastProgress.style.transition = "transform 5s linear";
      toastProgress.style.transform = "scaleX(0)";
    });
  });

  toastTimeout = setTimeout(() => {
    hideUndoToast();
  }, 5000);
}

// Toast hover events
undoToast.addEventListener("mouseenter", pauseToast);
undoToast.addEventListener("mouseleave", resumeToast);

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
  editIconOptionsContainer.querySelectorAll(".icon-option").forEach((opt) => {
    opt.classList.toggle("selected", opt.dataset.icon === editSelectedIcon);
  });

  // Reset icon picker to collapsed state
  editIconPickerToggle.classList.remove("open");
  editIconOptionsContainer.classList.remove("expanded");

  editListModal.classList.add("open");

  // Only auto-focus on desktop to avoid keyboard popup on mobile
  if (window.matchMedia("(hover: hover)").matches) {
    setTimeout(() => editListName.focus(), 100);
  }
}

function openEditItemModal(itemId, text) {
  editingItemId = itemId;
  editItemText.value = text;
  editItemModal.classList.add("open");

  // Only auto-focus on desktop to avoid keyboard popup on mobile
  if (window.matchMedia("(hover: hover)").matches) {
    setTimeout(() => {
      editItemText.focus();
      editItemText.select();
    }, 100);
  }
}

// Event Listeners

// Sidebar toggle (desktop)
sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
  localStorage.setItem(
    "sidebarCollapsed",
    sidebar.classList.contains("collapsed"),
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
deleteListBtn.addEventListener("click", async () => {
  editListModal.classList.remove("open");
  if (currentListId && lists.length > 0) {
    const list = lists.find((l) => l.id === currentListId);
    if (!list) return;
    const listName = list.name;
    const listIcon = list.icon || "list";
    const listSort = list.item_sort || "alphabetical";

    // Fetch all items and history before deleting for undo
    const allItems = await fetchWithRetry(
      `/api/lists/${currentListId}/items?include_completed=true`,
    );
    const savedItems = allItems || [];
    const savedHistory = await fetchWithRetry(
      `/api/lists/${currentListId}/history`,
    ) || [];

    await deleteList(currentListId);
    showUndoToast(`"${listName}" deleted`, async () => {
      // Restore list
      const newList = await fetchWriteWithRetry("/api/lists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: listName,
          icon: listIcon,
          undo: true
        }),
      });

      if (newList && newList.id) {
        // Restore list sort setting
        await fetchWriteWithRetry(`/api/lists/${newList.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            item_sort: listSort
          }),
        });

        // Restore all items
        for (const item of savedItems) {
          const restoredItem = await fetchWriteWithRetry(
            `/api/lists/${newList.id}/items`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                text: item.text,
                undo: true
              }),
            },
          );
          // If item was completed, mark it as completed
          if (item.completed && restoredItem?.id) {
            await fetchWriteWithRetry(`/api/items/${restoredItem.id}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                completed: true,
                undo: true
              }),
            });
          }
        }

        // Restore history entries
        if (savedHistory.length > 0) {
          await fetchWriteWithRetry(`/api/lists/${newList.id}/history`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(savedHistory),
          });
        }

        await fetchLists();
        selectList(newList.id);
      }
    });
  }
});

// Add list button
addListBtn.addEventListener("click", () => {
  newListModal.classList.add("open");
  newListName.value = "";
  selectedIcon = "list";
  updateIconPreview(iconPreview, selectedIcon);
  iconOptionsContainer.querySelectorAll(".icon-option").forEach((opt) => {
    opt.classList.toggle("selected", opt.dataset.icon === selectedIcon);
  });
  // Reset icon picker to collapsed state
  iconPickerToggle.classList.remove("open");
  iconOptionsContainer.classList.remove("expanded");
  setTimeout(() => newListName.focus(), 100);
});

// Icon selection (new list) — event delegation
iconOptionsContainer.addEventListener("click", (e) => {
  const option = e.target.closest(".icon-option");
  if (!option) return;
  selectedIcon = option.dataset.icon;
  updateIconPreview(iconPreview, selectedIcon);
  iconOptionsContainer.querySelectorAll(".icon-option").forEach((opt) => {
    opt.classList.toggle("selected", opt.dataset.icon === selectedIcon);
  });
});

// Icon selection (edit list) — event delegation
editIconOptionsContainer.addEventListener("click", (e) => {
  const option = e.target.closest(".icon-option");
  if (!option) return;
  editSelectedIcon = option.dataset.icon;
  updateIconPreview(editIconPreview, editSelectedIcon);
  editIconOptionsContainer.querySelectorAll(".icon-option").forEach((opt) => {
    opt.classList.toggle("selected", opt.dataset.icon === editSelectedIcon);
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
    await updateItem(editingItemId, {
      text
    });
    editItemModal.classList.remove("open");
    editingItemId = null;
  }
});

// Cancel edit item
cancelEditItem.addEventListener("click", () => {
  editItemModal.classList.remove("open");
  editingItemId = null;
});

// Delete item from edit modal
deleteEditItem.addEventListener("click", async () => {
  if (!editingItemId) return;

  const item = items.find((i) => i.id === editingItemId);
  const itemText = item ? item.text : "";
  const listId = currentListId;
  const itemId = editingItemId;

  editItemModal.classList.remove("open");
  editingItemId = null;

  await deleteItem(itemId);
  showUndoToast(`"${itemText}" deleted`, async () => {
    await createItem(listId, itemText, true);
  });
});

// Toast Undo button
toastUndo.addEventListener("click", async () => {
  if (toastUndoCallback) {
    await toastUndoCallback();
  }
  hideUndoToast();
});

// Toast Close button — dismiss without undo
toastClose.addEventListener("click", () => {
  hideUndoToast();
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

// Settings modal
const settingsModal = document.getElementById("settingsModal");
const settingsBtn = document.getElementById("settingsBtn");
const listSortSetting = document.getElementById("listSortSetting");
const cancelSettings = document.getElementById("cancelSettings");
const saveSettings = document.getElementById("saveSettings");
const clearCacheBtn = document.getElementById("clearCacheBtn");

settingsBtn.addEventListener("click", () => {
  listSortSetting.value = appSettings.list_sort || "alphabetical";
  settingsModal.classList.add("open");
  closeMobileMenu();
});

cancelSettings.addEventListener("click", () => {
  settingsModal.classList.remove("open");
});

saveSettings.addEventListener("click", async () => {
  const newListSort = listSortSetting.value;
  console.log("Saving settings:", {
    list_sort: newListSort
  });
  const success = await updateSettings({
    list_sort: newListSort
  });
  console.log("Settings saved:", success);
  settingsModal.classList.remove("open");
});

clearCacheBtn.addEventListener("click", async () => {
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

settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove("open");
  }
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Escape to close modals/panels
  if (e.key === "Escape") {
    newListModal.classList.remove("open");
    editListModal.classList.remove("open");
    editItemModal.classList.remove("open");
    settingsModal.classList.remove("open");
    editingItemId = null;
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
  }, {
    passive: true
  },
);

mainContent.addEventListener(
  "touchend",
  (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
  }, {
    passive: true
  },
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

// Debounced SSE fetch handlers to avoid duplicate work with direct calls
let sseListsTimeout = null;
let sseItemsTimeout = null;

function debouncedSSEFetchLists() {
  if (sseListsTimeout) clearTimeout(sseListsTimeout);
  sseListsTimeout = setTimeout(() => fetchLists(), 500);
}

function debouncedSSEFetchItems() {
  if (sseItemsTimeout) clearTimeout(sseItemsTimeout);
  sseItemsTimeout = setTimeout(() => fetchItems(currentListId), 500);
}

// SSE connection for real-time updates
let eventSource = null;
let sseReconnectTimeout = null;

/**
 * Connect to Server-Sent Events for real-time sync across devices.
 */
function connectSSE() {
  // Clear any pending reconnect
  if (sseReconnectTimeout) {
    clearTimeout(sseReconnectTimeout);
    sseReconnectTimeout = null;
  }

  // Close existing connection if any
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  eventSource = new EventSource("/api/events");

  eventSource.onopen = () => {
    console.log("SSE connected");
    updateOfflineIndicator(false);
  };

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "lists_changed") {
      debouncedSSEFetchLists();
    }

    if (data.type === "items_changed") {
      // Always refresh lists to update item count badges
      debouncedSSEFetchLists();
      // Only refresh items if we're viewing the affected list
      if (data.list_id === currentListId) {
        debouncedSSEFetchItems();
      }
    }
  };

  eventSource.onerror = () => {
    console.log("SSE connection lost");
    eventSource.close();
    eventSource = null;

    // Reconnect after delay (with backoff)
    sseReconnectTimeout = setTimeout(() => {
      console.log("SSE reconnecting...");
      connectSSE();
    }, 3000);
  };

  return eventSource;
}

/**
 * Reconnect SSE and refresh data when app becomes visible again.
 */
function handleVisibilityChange() {
  if (document.visibilityState === "visible") {
    // Reconnect SSE when app comes back to foreground
    connectSSE();
    // Refresh data in case we missed updates while in background
    if (currentListId) {
      fetchLists();
      fetchItems(currentListId);
    }
  }
}

// Reconnect SSE when page becomes visible (handles mobile background)
document.addEventListener("visibilitychange", handleVisibilityChange);

// Initialize
async function init() {
  await fetchSettings();
  await fetchLists();
  connectSSE();
}
init();

// Online/Offline detection
window.addEventListener("online", () => {
  updateOfflineIndicator(false);
  connectSSE(); // Reconnect SSE when back online
  fetchLists(); // Refresh data when back online
});

window.addEventListener("offline", () => {
  updateOfflineIndicator(true);
  // Close SSE to avoid reconnect attempts while offline
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (sseReconnectTimeout) {
    clearTimeout(sseReconnectTimeout);
    sseReconnectTimeout = null;
  }
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
      worker.postMessage({
        type: "SKIP_WAITING"
      });
      notification.remove();
    });

    // Dismiss button handler
    document.getElementById("dismiss-btn").addEventListener("click", () => {
      notification.remove();
    });
  }
}

// Visual viewport tracking for modal positioning (handles virtual keyboard)
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
