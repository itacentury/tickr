/**
 * Shared mutable application state.
 *
 * Exported as plain objects so every module references the same values.
 * This is a leaf node — no imports from other app modules.
 */

export const state = {
  db: null,
  lists: [],
  currentListId: null,
  items: [],
  categories: [],
  selectedIcon: "list",
  editingItemId: null,
  editingCategoryId: null,
  editSelectedIcon: "list",
  appSettings: { list_sort: "alphabetical" },
  itemCounts: {},
  // In-memory working copy of categories while a category-managing modal is
  // open. null = no draft active (normal operation reads state.categories).
  categoryDraft: null,
  // Snapshot of categories taken when the draft began. The commit diffs the
  // draft against this baseline (not against live state.categories), so a
  // category synced in while the modal is open is never clobbered.
  categoryDraftBase: null,
};

/** Active RxDB subscriptions that may need to be replaced on re-subscribe. */
export const subscriptions = {
  lists: null,
  items: null,
  itemsCount: null,
  categories: null,
};
