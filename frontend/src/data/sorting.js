/**
 * Pure sorting helpers for lists and items.
 *
 * No side effects beyond reading sort preferences from global state.
 */

import { state } from "../state.js";

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
