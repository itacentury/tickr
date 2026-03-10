/**
 * RxDB data operations, subscriptions, sorting, and navigation.
 *
 * All CRUD goes through the local RxDB database. Subscriptions provide
 * reactive updates that trigger re-renders automatically.
 *
 * Note: .exec() calls below are RxDB query execution, not shell commands.
 */

import { state, subscriptions } from "./state.js";
import * as dom from "./dom.js";
import { icons } from "./icons.js";
import { renderNavigation, renderItems } from "./render.js";

// ---- Helpers ----

/** Get current ISO timestamp. */
export function now() {
  return new Date().toISOString();
}

/** Get the count of non-completed items for a list. */
export async function getItemCount(listId) {
  const allItems = await state.db.items
    .find({ selector: { listId, completed: 0 } })
    .exec();
  return { remaining: allItems.length };
}

// ---- Settings ----

/**
 * Fetch settings from the server.
 * Settings are not stored in RxDB since they're lightweight global config.
 */
export async function fetchSettings() {
  try {
    const response = await fetch("/api/settings");
    if (response.ok) {
      state.appSettings = await response.json();
    }
  } catch {
    // Use defaults if offline
  }
}

/**
 * Update settings on the server and refresh local state.
 *
 * @param {Object} settings - Key-value pairs to update.
 * @returns {boolean} Whether the update succeeded.
 */
export async function updateSettings(settings) {
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!response.ok) return false;
    Object.assign(state.appSettings, settings);
    subscribeLists();
    return true;
  } catch {
    return false;
  }
}

// ---- Sorting ----

/**
 * Sort lists according to the current settings.
 *
 * @param {Array} listsData - The list documents to sort.
 * @returns {Array} Sorted list documents.
 */
export function sortLists(listsData) {
  const sort = state.appSettings.list_sort || "alphabetical";
  const sorted = [...listsData];
  switch (sort) {
    case "alphabetical":
      sorted.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
      break;
    case "alphabetical_desc":
      sorted.sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { sensitivity: "base" }),
      );
      break;
    case "created_desc":
      sorted.sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
      );
      break;
    case "created_asc":
      sorted.sort((a, b) =>
        (a.createdAt || "").localeCompare(b.createdAt || ""),
      );
      break;
    case "custom":
      sorted.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      break;
  }
  return sorted;
}

/**
 * Sort items according to the list's sort preference.
 *
 * @param {Array} itemsData - The item documents to sort.
 * @param {string} sortOption - The sort preference string.
 * @returns {Array} Sorted items.
 */
export function sortItems(itemsData, sortOption) {
  const sorted = [...itemsData];
  sorted.sort((a, b) => {
    switch (sortOption) {
      case "alphabetical":
        return a.text.localeCompare(b.text, undefined, { sensitivity: "base" });
      case "alphabetical_desc":
        return b.text.localeCompare(a.text, undefined, { sensitivity: "base" });
      case "created_desc":
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      case "created_asc":
        return (a.createdAt || "").localeCompare(b.createdAt || "");
      default:
        return a.text.localeCompare(b.text, undefined, { sensitivity: "base" });
    }
  });
  return sorted;
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
  subscriptions.lists = query.$.subscribe((docs) => {
    const sortedDocs = sortLists(docs.map((d) => d.toJSON()));
    state.lists = sortedDocs;
    renderNavigation();

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
        localStorage.removeItem("tickr_current_list");
        state.items = [];
        renderItems();
        dom.listTitle.textContent = "No Lists";
        document.title = "Tickr";
      }
    }
  });
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

  const query = state.db.items.find({ selector: { listId, completed: 0 } });
  subscriptions.items = query.$.subscribe((docs) => {
    const list = state.lists.find((l) => l.id === listId);
    const sortOption = list?.itemSort || "alphabetical";
    state.items = sortItems(
      docs.map((d) => d.toJSON()),
      sortOption,
    );
    renderItems();
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

  subscriptions.itemsCount = state.db.items.find().$.subscribe(() => {
    renderNavigation();
  });
}

// ---- Navigation ----

/**
 * Determine which list to select based on saved preference.
 *
 * @returns {string|null} The list ID to select initially.
 */
export function getInitialListId() {
  const savedId = localStorage.getItem("tickr_current_list");
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
  localStorage.setItem("tickr_current_list", listId);

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
    link.classList.toggle("active", link.dataset.id === listId);
  });

  subscribeItems(listId);
}

// ---- CRUD Operations ----

/**
 * Create a new list in RxDB.
 *
 * @param {string} name - The list name.
 * @param {string} icon - The icon key.
 */
export async function createList(name, icon) {
  const maxSortOrder = state.lists.reduce(
    (max, l) => Math.max(max, l.sortOrder || 0),
    -1,
  );
  const timestamp = now();
  const doc = await state.db.lists.insert({
    id: crypto.randomUUID(),
    name,
    icon: icon || "list",
    itemSort: "alphabetical",
    sortOrder: maxSortOrder + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  selectList(doc.id);
}

/**
 * Update a list in RxDB.
 *
 * @param {string} listId - The list ID to update.
 * @param {string} name - New name.
 * @param {string} icon - New icon key.
 * @param {string} itemSort - New sort preference.
 */
export async function updateList(listId, name, icon, itemSort) {
  const doc = await state.db.lists.findOne(listId).exec();
  if (!doc) return;
  await doc.patch({
    name,
    icon,
    itemSort,
    updatedAt: now(),
  });
  if (listId === state.currentListId) {
    dom.listTitle.textContent = name;
    document.title = `${name} - Tickr`;
    subscribeItems(state.currentListId);
  }
}

/**
 * Delete a list by RxDB soft-delete.
 *
 * @param {string} listId - The list ID to delete.
 */
export async function deleteList(listId) {
  const doc = await state.db.lists.findOne(listId).exec();
  if (!doc) return;

  const listItems = await state.db.items.find({ selector: { listId } }).exec();
  for (const item of listItems) {
    await item.remove();
  }

  await doc.remove();

  if (state.lists.length > 0) {
    selectList(state.lists[0].id);
  } else {
    state.currentListId = null;
    localStorage.removeItem("tickr_current_list");
    state.items = [];
    renderItems();
    dom.listTitle.textContent = "No Lists";
    document.title = "Tickr";
  }
}

/**
 * Create a new item in RxDB.
 *
 * @param {string} text - The item text.
 * @param {string} [listId] - The list to add to (defaults to current).
 */
export async function createItem(text, listId) {
  const targetList = listId || state.currentListId;
  if (!targetList) return;
  const timestamp = now();
  await state.db.items.insert({
    id: crypto.randomUUID(),
    listId: targetList,
    text,
    completed: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  });
}

/**
 * Update an item in RxDB.
 *
 * @param {string} itemId - The item ID to update.
 * @param {Object} data - Fields to update.
 */
export async function updateItem(itemId, data) {
  const doc = await state.db.items.findOne(itemId).exec();
  if (!doc) return;
  const patch = { updatedAt: now() };
  if (data.text !== undefined) patch.text = data.text;
  if (data.completed !== undefined) {
    patch.completed = data.completed ? 1 : 0;
    patch.completedAt = data.completed ? now() : null;
  }
  await doc.patch(patch);
}

/**
 * Delete an item by RxDB soft-delete.
 *
 * @param {string} itemId - The item ID to delete.
 */
export async function deleteItem(itemId) {
  const doc = await state.db.items.findOne(itemId).exec();
  if (!doc) return;
  await doc.remove();
}

/**
 * Reorder lists by updating sortOrder on each list.
 *
 * @param {string[]} listIds - Ordered list of list IDs.
 */
export async function reorderLists(listIds) {
  for (let i = 0; i < listIds.length; i++) {
    const doc = await state.db.lists.findOne(listIds[i]).exec();
    if (doc) {
      await doc.patch({ sortOrder: i, updatedAt: now() });
    }
  }
}
