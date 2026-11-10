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

/**
 * Fires each time the SSE sync stream opens, i.e. the server is reachable
 * again. A fallback for the browser's `online` event, which iOS PWAs and
 * flaky connections can miss.
 */
export const sseConnected$ = new Subject();

/**
 * Fires each time the server rejects a queued settings patch, after the
 * settings were restored from the server. Lets one listener report it no
 * matter which caller started the flush. A plain Subject drops events with no
 * subscriber, so that listener is wired before the startup flush (app.js).
 */
export const settingsRejected$ = new Subject();
