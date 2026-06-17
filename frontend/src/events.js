/**
 * Event listener wiring for the entire application.
 *
 * Barrel composing the per-feature wire*() helpers from ./events/. Exports a
 * single setupEventListeners() that calls them in order during initialization.
 * Importers keep using "./events.js" so the split stays internal.
 */

import {
  wireInitialUi,
  wireNavigation,
  wireItems,
  wireListModals,
  wireItemModal,
  wireMetrics,
  wireSettings,
} from "./events/modals.js";
import { wireCategories } from "./events/categories.js";
import { wireHistory } from "./events/history.js";
import {
  wireKeyboardShortcuts,
  wireSwipeNavigation,
  wireVisualViewport,
} from "./events/gestures.js";

/** Attach all application event listeners. */
export function setupEventListeners() {
  wireInitialUi();
  wireNavigation();
  wireItems();
  wireListModals();
  wireItemModal();
  wireCategories();
  wireHistory();
  wireMetrics();
  wireSettings();
  wireKeyboardShortcuts();
  wireSwipeNavigation();
  wireVisualViewport();
}
