/**
 * RxDB reactive subscriptions, navigation, and server-side settings.
 *
 * Subscriptions provide reactive updates that trigger re-renders automatically.
 * Navigation (selectList) is kept here because it is tightly coupled to the
 * item/category subscriptions it wires up.
 *
 * Note: .exec() calls below are RxDB query execution, not shell commands.
 */

import { state, subscriptions } from "../state.js";
import * as dom from "../dom.js";
import { icons } from "../icons.js";
import {
  navigationChanged$,
  itemsChanged$,
  categoriesChanged$,
} from "../bus.js";
import {
  getStorageItem,
  setStorageItem,
  removeStorageItem,
} from "../storage.js";
import { sortLists, sortItems } from "./sorting.js";
import { isAppIdle, resolveDefaultListId } from "./default-list.js";

// ---- Settings ----

const SETTINGS_CACHE_KEY = "tickr_settings";
const SERVER_CONFIG_CACHE_KEY = "tickr_server_config";
const PENDING_SETTINGS_KEY = "tickr_pending_settings";

/**
 * Persist an object so an offline cold start can restore it.
 *
 * @param {string} key - Storage key.
 * @param {Object} value - Object to cache.
 */
function cacheObject(key, value) {
  setStorageItem(key, JSON.stringify(value));
}

/**
 * Restore a cached plain object.
 *
 * @param {string} key - Storage key.
 * @returns {Object|null} The cached object, or null if missing or unusable.
 */
function restoreCachedObject(key) {
  const raw = getStorageItem(key);
  if (raw === null) return null;
  try {
    const cached = JSON.parse(raw);
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      return cached;
    }
  } catch {
    // Corrupt cache: treat as missing.
  }
  return null;
}

/**
 * Fetch a JSON object from the server and cache it, falling back to the last
 * cached copy when the server is unreachable (e.g. offline cold start).
 *
 * @param {string} url - Endpoint to fetch.
 * @param {string} cacheKey - Storage key for the offline copy.
 * @returns {Promise<Object|null>} The fresh or cached object, or null if neither is available.
 */
async function fetchCachedObject(url, cacheKey) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const fresh = await response.json();
      cacheObject(cacheKey, fresh);
      return fresh;
    }
  } catch {
    // Offline: fall through to the cache.
  }
  return restoreCachedObject(cacheKey);
}

/**
 * Fetch settings from the server, keeping the current ones if neither the
 * server nor the cache has any.
 * Settings are not stored in RxDB since they're lightweight global config.
 */
export async function fetchSettings() {
  await flushPendingSettings();
  await loadSettings();
}

/** Load settings from the server or cache, keeping edits still pending. */
async function loadSettings() {
  const settings = await fetchCachedObject(
    "/api/v1/settings",
    SETTINGS_CACHE_KEY,
  );
  // Edits still waiting for the server must not be overwritten by stale values.
  if (settings) state.appSettings = { ...settings, ...getPendingSettings() };
}

/** Fetch the read-only server configuration (e.g. the default-list timeout). */
export async function fetchServerConfig() {
  const config = await fetchCachedObject(
    "/api/v1/config",
    SERVER_CONFIG_CACHE_KEY,
  );
  if (config) state.serverConfig = config;
}

/** @returns {Object} Settings edits not yet accepted by the server. */
function getPendingSettings() {
  return restoreCachedObject(PENDING_SETTINGS_KEY) ?? {};
}

/** @type {Promise<"synced"|"queued"|"rejected">|null} */
let flushInFlight = null;

/**
 * Send the pending settings patch to the server.
 *
 * An unreachable server keeps the patch for a later retry; the service worker
 * answers offline API requests with a synthetic 503, so that counts as
 * unreachable too. Any other error drops the patch, since resending cannot
 * succeed, and restores the server's settings over the optimistic ones.
 *
 * @returns {Promise<"synced"|"queued"|"rejected">} Outcome of the attempt.
 */
export function flushPendingSettings() {
  // The online event and an app resume can both trigger a flush at once.
  flushInFlight ??= sendPendingSettings().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

/** @returns {Promise<"synced"|"queued"|"rejected">} */
async function sendPendingSettings() {
  const pending = getPendingSettings();
  if (Object.keys(pending).length === 0) return "synced";

  let response;
  try {
    response = await fetch("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending),
    });
  } catch {
    return "queued";
  }
  if (response.status === 503) return "queued";

  removeStorageItem(PENDING_SETTINGS_KEY);
  if (response.ok) return "synced";

  // Not fetchSettings(): its flush would await this very flush and deadlock.
  await loadSettings();
  subscribeLists();
  return "rejected";
}

/**
 * Apply settings locally right away and send them to the server, queueing
 * them for a later retry while the server is unreachable.
 *
 * @param {Object} settings - Key-value pairs to update.
 * @returns {Promise<boolean>} False only if the server rejected the update.
 */
export async function updateSettings(settings) {
  cacheObject(PENDING_SETTINGS_KEY, { ...getPendingSettings(), ...settings });
  Object.assign(state.appSettings, settings);
  cacheObject(SETTINGS_CACHE_KEY, state.appSettings);
  subscribeLists();
  return (await flushPendingSettings()) !== "rejected";
}

// ---- Subscriptions ----

/**
 * Subscribe to the lists collection with reactive updates.
 * Called on init and whenever sort settings change.
 */
export function subscribeLists() {
  if (subscriptions.lists) {
    subscriptions.lists.unsubscribe();
  }

  const query = state.db.lists.find();
  subscriptions.lists = query.$.subscribe(applyListsSnapshot);
}

/**
 * Recompute state.lists from a set of RxDB list docs, hiding any list whose
 * deletion is still pending (undo window open), then re-render and reconcile
 * the current selection. Shared by the live subscription and refreshLists().
 *
 * @param {Array} docs - RxDB list documents (or anything with toJSON()).
 */
function applyListsSnapshot(docs) {
  const visible = docs
    .map((d) => d.toJSON())
    .filter((l) => !state.pendingDeletes.lists.has(l.id));
  state.lists = sortLists(visible);
  navigationChanged$.next();

  if (state.lists.length > 0 && !state.currentListId) {
    selectList(getInitialListId());
  }

  if (
    state.currentListId &&
    !state.lists.find((l) => l.id === state.currentListId)
  ) {
    if (state.lists.length > 0) {
      selectList(state.lists[0].id);
    } else {
      state.currentListId = null;
      removeStorageItem("tickr_current_list");
      state.items = [];
      itemsChanged$.next();
      dom.listTitle.textContent = "No Lists";
      document.title = "Tickr";
    }
  }
}

/**
 * Re-derive state.lists from the database without waiting for an RxDB write.
 * Needed when only the pending-delete set changed (mark/unmark), which the
 * reactive subscription does not observe.
 */
export async function refreshLists() {
  const docs = await state.db.lists.find().exec();
  applyListsSnapshot(docs);
}

/**
 * Subscribe to items for a specific list with reactive updates.
 *
 * @param {string} listId - The list ID to subscribe to.
 */
export function subscribeItems(listId) {
  if (subscriptions.items) {
    subscriptions.items.unsubscribe();
  }

  const query = state.db.items.find({ selector: { listId, completed: false } });
  subscriptions.items = query.$.subscribe((docs) =>
    applyItemsSnapshot(docs, listId),
  );
}

/**
 * Recompute state.items for a list from RxDB item docs, hiding any item whose
 * deletion is still pending. Shared by the live subscription and
 * refreshCurrentItems().
 *
 * @param {Array} docs - RxDB item documents for the list.
 * @param {string} listId - The list the docs belong to.
 */
function applyItemsSnapshot(docs, listId) {
  const list = state.lists.find((l) => l.id === listId);
  const sortOption = list?.itemSort || "alphabetical";
  const visible = docs
    .map((d) => d.toJSON())
    .filter((i) => !state.pendingDeletes.items.has(i.id));
  state.items = sortItems(visible, sortOption);
  itemsChanged$.next();
}

/**
 * Re-derive state.items for the current list without waiting for an RxDB
 * write. Needed when only the pending-delete set changed (mark/unmark item).
 */
export async function refreshCurrentItems() {
  if (!state.currentListId) return;
  const docs = await state.db.items
    .find({ selector: { listId: state.currentListId, completed: false } })
    .exec();
  applyItemsSnapshot(docs, state.currentListId);
}

/**
 * Subscribe to categories of a specific list.
 *
 * @param {string} listId - The list ID whose categories to track.
 */
export function subscribeCategories(listId) {
  if (subscriptions.categories) {
    subscriptions.categories.unsubscribe();
  }

  const query = state.db.categories.find({ selector: { listId } });
  subscriptions.categories = query.$.subscribe((docs) => {
    state.categories = docs
      .map((d) => d.toJSON())
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    categoriesChanged$.next();
    // Items render shows category badges; refresh when category names/colors change.
    itemsChanged$.next();
  });
}

/**
 * Subscribe to all items globally to keep sidebar counts in sync.
 * Triggers a navigation re-render whenever any item changes.
 */
export function subscribeItemCounts() {
  if (subscriptions.itemsCount) {
    subscriptions.itemsCount.unsubscribe();
  }

  subscriptions.itemsCount = state.db.items
    .find()
    .$.subscribe(applyItemCountsSnapshot);
}

/**
 * Recompute per-list open-item counts from RxDB item docs, skipping completed
 * items and any item whose deletion is still pending. Shared by the live
 * subscription and refreshItemCounts().
 *
 * @param {Array} docs - All RxDB item documents.
 */
function applyItemCountsSnapshot(docs) {
  const counts = {};
  for (const doc of docs) {
    if (doc.completed || state.pendingDeletes.items.has(doc.id)) continue;
    counts[doc.listId] = (counts[doc.listId] || 0) + 1;
  }
  state.itemCounts = counts;
  navigationChanged$.next();
}

/**
 * Re-derive sidebar item counts without waiting for an RxDB write. Needed when
 * only the pending-delete set changed (mark/unmark).
 */
export async function refreshItemCounts() {
  const docs = await state.db.items.find().exec();
  applyItemCountsSnapshot(docs);
}

// ---- Navigation ----

/**
 * Determine which list to select: the default list after an idle period,
 * otherwise the last viewed list.
 *
 * @returns {string|null} The list ID to select initially.
 */
export function getInitialListId() {
  const defaultId = resolveDefaultListId(state.lists, state.appSettings);
  if (defaultId && isAppIdle(state.serverConfig)) return defaultId;

  const savedId = getStorageItem("tickr_current_list");
  if (savedId && state.lists.some((l) => l.id === savedId)) {
    return savedId;
  }
  return state.lists.length > 0 ? state.lists[0].id : null;
}

/**
 * Select a list and subscribe to its items.
 *
 * @param {string} listId - The list ID to select.
 */
export function selectList(listId) {
  state.currentListId = listId;
  setStorageItem("tickr_current_list", listId);

  const list = state.lists.find((l) => l.id === listId);
  if (list) {
    dom.listTitle.textContent = list.name;
    document.title = `${list.name} - Tickr`;
    if (dom.listTitleIcon) {
      // Static SVG from icons map — safe for innerHTML
      dom.listTitleIcon.innerHTML = icons[list.icon] || icons.list;
    }
  }

  dom.navList.querySelectorAll(".nav-link").forEach((link) => {
    const el = /** @type {HTMLElement} */ (link);
    el.classList.toggle("active", el.dataset.id === listId);
  });

  subscribeItems(listId);
  subscribeCategories(listId);
}
