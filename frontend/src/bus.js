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
