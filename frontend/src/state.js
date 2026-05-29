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
};

/** Active RxDB subscriptions that may need to be replaced on re-subscribe. */
export const subscriptions = {
  lists: null,
  items: null,
  itemsCount: null,
  categories: null,
};
