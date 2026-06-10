/**
 * Centralized timing constants (delays, timeouts, intervals) in milliseconds.
 *
 * Single source of truth for the app's tunable timings, replacing magic-number
 * literals that were scattered across modules. Names use the `_MS` suffix and
 * carry the rationale, so the intent behind a value survives without grepping
 * its call site.
 *
 * Change these with care: several are tuned for user experience (toast windows,
 * sync-indicator flicker) or backend behavior (SSE staleness vs. heartbeat
 * cadence). Values that are otherwise identical are kept as distinct constants
 * on purpose — they encode unrelated concerns and must be free to drift apart.
 */

// --- Sync indicator ---

/** Delay before the "Syncing" indicator appears, to avoid flicker on fast syncs. */
export const SYNC_INDICATOR_SHOW_DELAY_MS = 500;

// --- Toast notifications ---

/** Undo window: how long the undo toast stays before the action is committed. */
export const UNDO_WINDOW_MS = 5000;

/** Auto-dismiss delay for the error toast. */
export const ERROR_TOAST_DURATION_MS = 4000;

/**
 * Toast message swap animation. Mirrors the `.toast-message` opacity transition
 * in `styles/toast.css` (150ms) — keep both in sync if changed.
 */
export const TOAST_SWAP_ANIMATION_MS = 150;

// --- SSE / replication ---

/** Delay before reconnecting the shared SSE stream after an error. */
export const SSE_RECONNECT_DELAY_MS = 3000;

/**
 * Force a reconnect if no SSE frame (data or heartbeat) arrives within this
 * window. The server heartbeats every ~15s, so this is ~2.5 missed beats.
 */
export const SSE_STALE_TIMEOUT_MS = 40000;

/** Abort replication fetches that hang past this; RxDB retries via retryTime. */
export const REPLICATION_FETCH_TIMEOUT_MS = 15000;

/** RxDB `retryTime` for failed pull/push on every collection. */
export const REPLICATION_RETRY_MS = 5000;

// --- Polling / background updates ---

/** Refresh interval for the metrics dashboard while its modal is open. */
export const METRICS_POLL_INTERVAL_MS = 10000;

/** Interval for polling the service worker for a new app version. */
export const SW_UPDATE_CHECK_INTERVAL_MS = 60000;

// --- Focus / interaction workarounds ---

/** Defer focus until a modal has settled (focus is unreliable immediately). */
export const MODAL_FOCUS_DELAY_MS = 100;

/**
 * Grace period on autocomplete blur so a mousedown on the menu runs first.
 * Distinct from MODAL_FOCUS_DELAY_MS despite the shared value — different concern.
 */
export const AUTOCOMPLETE_BLUR_DELAY_MS = 100;

/**
 * Per-leg duration of the list swipe transition. Mirrors the slide/fade
 * animations in `styles/animations.css` (0.15s) — keep both in sync if changed.
 */
export const LIST_SWIPE_ANIMATION_MS = 150;
