/**
 * Application event bus.
 *
 * Decouples the data layer from the view layer: data.js writes to state
 * and emits on these subjects; render.js subscribes and re-renders.
 * This enforces a one-way dependency: render → data.
 */

import { Subject } from "rxjs";

/** Fires when state.lists or state.itemCounts changed. */
export const navigationChanged$ = new Subject();

/** Fires when state.items changed. */
export const itemsChanged$ = new Subject();

/** Fires when state.categories changed. */
export const categoriesChanged$ = new Subject();

/**
 * Fires when a request is rejected with 401 (session expired/missing).
 *
 * Lives here to avoid a circular import between the data layer
 * (replication.js, which detects the 401) and the app entry (main.js,
 * which owns the login gate and re-renders the login view).
 */
export const authExpired$ = new Subject();
