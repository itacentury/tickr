/**
 * RxDB data operations, subscriptions, sorting, and navigation.
 *
 * Barrel re-exporting the focused modules under ./data/. Importers keep using
 * "./data.js" so the split stays internal. All CRUD goes through the local
 * RxDB database; subscriptions provide reactive re-renders.
 */

export * from "./data/sorting.js";
export * from "./data/subscriptions.js";
export * from "./data/crud.js";
export * from "./data/category-draft.js";
