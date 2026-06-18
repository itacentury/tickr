/**
 * RxDB write operations for lists, items, categories, and history.
 *
 * All CRUD goes through the local RxDB database; replication syncs changes to
 * the server. Deletions are deferred behind an undo window via pendingDeletes.
 *
 * Note: .exec() calls below are RxDB query execution, not shell commands.
 */

import { state } from "../state.js";
import * as dom from "../dom.js";
import { showErrorToast } from "../toast.js";
import { reportError } from "../error-reporting.js";
import {
  refreshLists,
  refreshCurrentItems,
  refreshItemCounts,
  selectList,
  subscribeItems,
} from "./subscriptions.js";

// ---- Helpers ----

/** Get current ISO timestamp. */
export function now() {
  return new Date().toISOString();
}

/** Get the count of non-completed items for a list. */
export async function getItemCount(listId) {
  try {
    const allItems = await state.db.items
      .find({ selector: { listId, completed: false } })
      .exec();
    return { remaining: allItems.length };
  } catch (error) {
    reportError("count items", error);
    return { remaining: 0 };
  }
}

// ---- List CRUD ----

/**
 * Create a new list in RxDB.
 *
 * @param {string} name - The list name.
 * @param {string} icon - The icon key.
 */
export async function createList(name, icon) {
  try {
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
  } catch (error) {
    reportError("create list", error);
    showErrorToast("Failed to create list");
  }
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
  try {
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
  } catch (error) {
    reportError("update list", error);
    showErrorToast("Failed to update list");
  }
}

/**
 * Begin deleting a list: hide it (and its items) from the UI and navigate
 * away, but defer the actual RxDB removal until the undo window expires. The
 * documents — and their history — stay intact, so an undo is a no-op revert.
 *
 * @param {string} listId - The list ID to delete.
 * @returns {Promise<string[]>} The IDs of the list's items, needed by
 *   commit/unmark to resolve the deferred deletion.
 */
export async function markListPendingDelete(listId) {
  try {
    const listItems = await state.db.items
      .find({ selector: { listId } })
      .exec();
    const itemIds = listItems.map((d) => d.id);

    state.pendingDeletes.lists.add(listId);
    for (const id of itemIds) state.pendingDeletes.items.add(id);

    // refreshLists() re-renders without the hidden list and, since it is the
    // current list, navigates away (or clears to "No Lists") via its built-in
    // selection-reconciliation logic.
    await refreshLists();
    await refreshItemCounts();

    return itemIds;
  } catch (error) {
    reportError("delete list", error);
    showErrorToast("Failed to delete list");
    return [];
  }
}

/**
 * Finalize a deferred list deletion: actually soft-delete the list and its
 * items in RxDB (which then syncs). Called when the undo window expires.
 *
 * @param {string} listId - The list ID being deleted.
 * @param {string[]} itemIds - The list's item IDs marked pending.
 */
export async function commitListDelete(listId, itemIds) {
  try {
    const listItems = await state.db.items
      .find({ selector: { listId } })
      .exec();
    for (const item of listItems) {
      await item.remove();
    }
    const doc = await state.db.lists.findOne(listId).exec();
    if (doc) await doc.remove();
  } catch (error) {
    reportError("delete list", error);
    showErrorToast("Failed to delete list");
  } finally {
    state.pendingDeletes.lists.delete(listId);
    for (const id of itemIds) state.pendingDeletes.items.delete(id);
  }
}

/**
 * Cancel a deferred list deletion (undo): clear the pending flags and restore
 * the list to the UI. The documents were never removed, so this is a pure
 * revert with the original IDs and history.
 *
 * @param {string} listId - The list ID to restore.
 * @param {string[]} itemIds - The list's item IDs to un-hide.
 */
export async function unmarkListPendingDelete(listId, itemIds) {
  state.pendingDeletes.lists.delete(listId);
  for (const id of itemIds) state.pendingDeletes.items.delete(id);

  try {
    await refreshLists();
    await refreshItemCounts();
    selectList(listId);
  } catch (error) {
    reportError("restore list", error);
    showErrorToast("Failed to restore list");
  }
}

// ---- Item CRUD ----

/**
 * Create a new item in RxDB.
 *
 * @param {string} text - The item text.
 * @param {string} [listId] - The list to add to (defaults to current).
 */
export async function createItem(text, listId, categoryId = null) {
  const targetList = listId || state.currentListId;
  if (!targetList) return;
  try {
    const timestamp = now();
    await state.db.items.insert({
      id: crypto.randomUUID(),
      listId: targetList,
      text,
      completed: false,
      categoryId: categoryId || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    });
  } catch (error) {
    reportError("create item", error);
    showErrorToast("Failed to create item");
  }
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
  try {
    const patch = { updatedAt: now() };
    if (data.text !== undefined) patch.text = data.text;
    if (data.completed !== undefined) {
      patch.completed = !!data.completed;
      patch.completedAt = data.completed ? now() : null;
    }
    if (data.categoryId !== undefined) {
      patch.categoryId = data.categoryId || null;
    }
    await doc.patch(patch);
  } catch (error) {
    reportError("update item", error);
    showErrorToast("Failed to update item");
  }
}

/**
 * Begin deleting an item: hide it from the UI but defer the actual RxDB
 * removal until the undo window expires. The document keeps its ID and all
 * fields (completed, category, createdAt), so an undo restores it verbatim.
 *
 * @param {string} itemId - The item ID to delete.
 */
export async function markItemPendingDelete(itemId) {
  state.pendingDeletes.items.add(itemId);
  try {
    await refreshCurrentItems();
    await refreshItemCounts();
  } catch (error) {
    reportError("delete item", error);
    showErrorToast("Failed to delete item");
  }
}

/**
 * Finalize a deferred item deletion: soft-delete the item in RxDB (syncs).
 * Called when the undo window expires.
 *
 * @param {string} itemId - The item ID being deleted.
 */
export async function commitItemDelete(itemId) {
  try {
    const doc = await state.db.items.findOne(itemId).exec();
    if (doc) await doc.remove();
  } catch (error) {
    reportError("delete item", error);
    showErrorToast("Failed to delete item");
  } finally {
    state.pendingDeletes.items.delete(itemId);
  }
}

/**
 * Cancel a deferred item deletion (undo): clear the pending flag and restore
 * the item to the UI. The document was never removed.
 *
 * @param {string} itemId - The item ID to restore.
 */
export async function unmarkItemPendingDelete(itemId) {
  state.pendingDeletes.items.delete(itemId);
  try {
    await refreshCurrentItems();
    await refreshItemCounts();
  } catch (error) {
    reportError("restore item", error);
    showErrorToast("Failed to restore item");
  }
}

/**
 * Restore a soft-deleted item from the history drawer by un-tombstoning it.
 *
 * RxDB's upsert resurrects a deleted document: the insert conflicts on the
 * existing (deleted) primary key, then writes a fresh non-deleted revision.
 * Replication pushes the `_deleted: 1 → 0` transition, which the server logs
 * as `item_restored`. The item always returns as active.
 *
 * @param {string} itemId - The item ID to restore.
 * @param {{listId: string, text: string, categoryId?: string|null, createdAt?: string}} fields
 *   The item fields to reconstruct, derived from its history card.
 * @returns {Promise<boolean>} True on success, false if the restore failed.
 */
export async function restoreItem(itemId, fields) {
  try {
    const timestamp = now();
    await state.db.items.upsert({
      id: itemId,
      listId: fields.listId,
      text: fields.text,
      completed: false,
      categoryId: fields.categoryId ?? null,
      createdAt: fields.createdAt ?? timestamp,
      updatedAt: timestamp,
      completedAt: null,
    });
    return true;
  } catch (error) {
    reportError("restore item", error);
    showErrorToast("Failed to restore item");
    return false;
  }
}

// ---- History ----

/**
 * Begin removing an item's card from history: flag it as pending-hidden so the
 * drawer drops it immediately. The server rows are untouched until commit.
 *
 * @param {string} itemId - The item ID whose history card is being removed.
 */
export function markHistoryPendingHide(itemId) {
  state.pendingDeletes.history.add(itemId);
}

/**
 * Cancel a deferred history removal (undo): clear the pending flag so the card
 * reappears. No server call was made.
 *
 * @param {string} itemId - The item ID to un-hide.
 */
export function unmarkHistoryPendingHide(itemId) {
  state.pendingDeletes.history.delete(itemId);
}

/**
 * Finalize a deferred history removal: soft-hide the item's history rows on the
 * server. Called when the undo window expires.
 *
 * @param {string} itemId - The item ID whose history is being hidden.
 * @param {string} listId - The list the item belongs to.
 */
export async function commitHistoryHide(itemId, listId) {
  try {
    const response = await fetch(
      `/api/v1/lists/${listId}/history/hide?item_id=${encodeURIComponent(itemId)}`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(`Hide request failed with status ${response.status}`);
    }
  } catch (error) {
    reportError("hide history", error);
    showErrorToast("Couldn't remove from history");
  } finally {
    state.pendingDeletes.history.delete(itemId);
  }
}

// ---- Category CRUD ----

/**
 * Create a new category in RxDB and return the resulting document.
 *
 * @param {string} listId - The list the category belongs to.
 * @param {string} name - Category name.
 * @param {string} color - Hex color string ("#rrggbb").
 * @returns {Promise<Object|null>} The inserted document or null on failure.
 */
export async function createCategory(listId, name, color) {
  try {
    const timestamp = now();
    const doc = await state.db.categories.insert({
      id: crypto.randomUUID(),
      listId,
      name,
      color,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return doc.toJSON();
  } catch (error) {
    reportError("create category", error);
    showErrorToast("Failed to create category");
    return null;
  }
}

/**
 * Update a category's name and/or color.
 *
 * @param {string} categoryId - Category to update.
 * @param {{name?: string, color?: string}} data - Patch fields.
 */
export async function updateCategory(categoryId, data) {
  const doc = await state.db.categories.findOne(categoryId).exec();
  if (!doc) return;
  try {
    const patch = { updatedAt: now() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    await doc.patch(patch);
  } catch (error) {
    reportError("update category", error);
    showErrorToast("Failed to update category");
  }
}

/**
 * Soft-delete a category and clear it from all items in the same list.
 * Performs item updates locally first, then removes the category - so a
 * mid-flight crash leaves no items pointing at a phantom category.
 *
 * @param {string} categoryId - Category to delete.
 */
export async function deleteCategory(categoryId) {
  const doc = await state.db.categories.findOne(categoryId).exec();
  if (!doc) return;
  try {
    const affected = await state.db.items
      .find({ selector: { categoryId } })
      .exec();
    for (const item of affected) {
      await item.patch({ categoryId: null, updatedAt: now() });
    }
    await doc.remove();
  } catch (error) {
    reportError("delete category", error);
    showErrorToast("Failed to delete category");
  }
}

/**
 * Reorder lists by updating sortOrder on each list.
 *
 * @param {string[]} listIds - Ordered list of list IDs.
 */
export async function reorderLists(listIds) {
  try {
    for (let i = 0; i < listIds.length; i++) {
      const doc = await state.db.lists.findOne(listIds[i]).exec();
      if (doc) {
        await doc.patch({ sortOrder: i, updatedAt: now() });
      }
    }
  } catch (error) {
    reportError("reorder lists", error);
    showErrorToast("Failed to reorder lists");
  }
}
