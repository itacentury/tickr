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
  selectedIcon: "list",
  editingItemId: null,
  editSelectedIcon: "list",
  appSettings: { list_sort: "alphabetical" },
};

/** Active RxDB subscriptions that may need to be replaced on re-subscribe. */
export const subscriptions = {
  lists: null,
  items: null,
  itemsCount: null,
};
