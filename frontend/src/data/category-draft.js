/**
 * Transactional staging for category editing sessions.
 *
 * Inline add/edit/delete actions mutate an in-memory draft until
 * commitCategoryDraft persists the diff against the baseline snapshot (or
 * discardCategoryDraft throws it away). Reuses the CRUD helpers at commit time.
 */

import { state } from "../state.js";
import { createCategory, updateCategory, deleteCategory } from "./crud.js";

/** Sort a category draft array by name, matching subscribeCategories. */
function sortCategoryDraft() {
  state.categoryDraft.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Start a category editing session: snapshot the committed categories into an
 * in-memory draft. All inline add/edit/delete actions mutate the draft until
 * commitCategoryDraft persists them (or discardCategoryDraft throws them away).
 */
export function beginCategoryDraft() {
  state.categoryDraft = state.categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
  }));
  // Independent baseline copy — the commit diffs against this, not against the
  // live (replication-mutated) state.categories.
  state.categoryDraftBase = state.categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
  }));
}

/** Throw away the draft without touching the DB. */
export function discardCategoryDraft() {
  state.categoryDraft = null;
  state.categoryDraftBase = null;
}

/**
 * Add a new category to the draft with a temporary id. The real id is
 * assigned by createCategory at commit time.
 *
 * @returns {Object} The created draft entry (with its temp id).
 */
export function draftAddCategory(name, color) {
  const entry = { id: `tmp_${crypto.randomUUID()}`, name, color, _new: true };
  state.categoryDraft.push(entry);
  sortCategoryDraft();
  return entry;
}

/** Mutate a draft entry's name/color in place. */
export function draftUpdateCategory(id, { name, color }) {
  const entry = state.categoryDraft.find((c) => c.id === id);
  if (!entry) return;
  if (name !== undefined) entry.name = name;
  if (color !== undefined) entry.color = color;
  sortCategoryDraft();
}

/** Remove a draft entry. Deletion of committed ones is resolved at commit. */
export function draftDeleteCategory(id) {
  state.categoryDraft = state.categoryDraft.filter((c) => c.id !== id);
}

/**
 * Persist the draft against the baseline taken at beginCategoryDraft: delete
 * categories the user removed, create new ones, and update changed ones.
 * Diffing against the baseline (not live state.categories) means a category
 * synced in while the modal was open is left untouched. Reuses the existing
 * CRUD helpers (deleteCategory also clears the category from affected items).
 *
 * @param {string} listId - The list the categories belong to.
 * @returns {Promise<Map<string,string>>} Map of temp id -> real id for new ones.
 */
export async function commitCategoryDraft(listId) {
  const idMap = new Map();
  const draft = state.categoryDraft;
  if (!draft) return idMap;
  const base = state.categoryDraftBase ?? [];

  // Deletions: baseline categories the user removed from the draft.
  const draftIds = new Set(draft.map((c) => c.id));
  for (const original of base) {
    if (!draftIds.has(original.id)) {
      await deleteCategory(original.id);
    }
  }

  for (const entry of draft) {
    if (entry._new) {
      const created = await createCategory(listId, entry.name, entry.color);
      if (created) idMap.set(entry.id, created.id);
    } else {
      const orig = base.find((c) => c.id === entry.id);
      if (orig && (orig.name !== entry.name || orig.color !== entry.color)) {
        await updateCategory(entry.id, {
          name: entry.name,
          color: entry.color,
        });
      }
    }
  }

  return idMap;
}
