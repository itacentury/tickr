/**
 * Default-list helpers: decide whether the app has been idle long enough to
 * reopen the user's default list instead of the last viewed one.
 *
 * The default list id comes from the server settings (`default_list_id`), the
 * idle timeout from the read-only server config
 * (`default_list_timeout_minutes`). The moment the app was hidden is kept per
 * tab in memory for resumes, and in storage for cold starts. Storage is shared
 * by all tabs, so a resuming tab must not read it: another tab hiding later
 * would overwrite this tab's hide time. The idle check is consumed once per hide:
 * after it has been evaluated, the tab counts as active until it is hidden again.
 */

import { getStorageItem, setStorageItem } from "../storage.js";

const LAST_HIDDEN_KEY = "tickr_last_hidden_at";
const FALLBACK_TIMEOUT_MINUTES = 30;
const MIN_TIMEOUT_MINUTES = 1;
const MS_PER_MINUTE = 60_000;

/** @type {number|null} */
let lastHiddenAtInTab = null;
let isIdleCheckDone = false;

/**
 * Whether the app has been in the background for at least the timeout.
 * Without a recorded timestamp (first launch) the app counts as idle.
 *
 * @param {number|null} lastHiddenAt - Epoch ms when the app was last hidden.
 * @param {number} now - Current epoch ms.
 * @param {number} timeoutMinutes - Idle timeout in minutes.
 * @returns {boolean}
 */
export function isIdleExpired(lastHiddenAt, now, timeoutMinutes) {
  if (lastHiddenAt === null) return true;
  return now - lastHiddenAt >= timeoutMinutes * MS_PER_MINUTE;
}

/**
 * Read the idle timeout from the server config, falling back when absent or
 * invalid. Values below one minute are clamped so a quick app switch never
 * counts as idle.
 *
 * @param {{default_list_timeout_minutes?: unknown}} config - Server config.
 * @returns {number} Timeout in minutes.
 */
export function getIdleTimeoutMinutes(config) {
  const minutes = config.default_list_timeout_minutes;
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
    return FALLBACK_TIMEOUT_MINUTES;
  }
  return Math.max(MIN_TIMEOUT_MINUTES, minutes);
}

/**
 * The default list id, if one is set and the list still exists.
 *
 * @param {Array<{id: string}>} lists - Currently visible lists.
 * @param {Record<string, string>} settings - Server settings.
 * @returns {string|null}
 */
export function resolveDefaultListId(lists, settings) {
  const defaultId = settings.default_list_id;
  if (!defaultId) return null;
  return lists.some((list) => list.id === defaultId) ? defaultId : null;
}

/**
 * Remember when the app went to the background.
 *
 * @param {number} [now] - Epoch ms; defaults to the current time.
 * @returns {void}
 */
export function recordHidden(now = Date.now()) {
  lastHiddenAtInTab = now;
  isIdleCheckDone = false;
  setStorageItem(LAST_HIDDEN_KEY, String(now));
}

/**
 * Consume the current hide and report whether the app was idle long enough
 * to reopen the default list.
 * Prefers this tab's own hide time; falls back to storage on a cold start.
 * Later calls return false until the next hide, because the app has been in
 * use since and the old hide time no longer reflects idleness.
 *
 * @param {{default_list_timeout_minutes?: unknown}} config - Server config.
 * @param {number} [now] - Epoch ms; defaults to the current time.
 * @returns {boolean}
 */
export function consumeIdle(config, now = Date.now()) {
  if (isIdleCheckDone) return false;
  isIdleCheckDone = true;
  const lastHiddenAt = lastHiddenAtInTab ?? readStoredHiddenAt();
  return isIdleExpired(lastHiddenAt, now, getIdleTimeoutMinutes(config));
}

/** @returns {number|null} Hide time persisted by the last hidden tab, if valid. */
function readStoredHiddenAt() {
  const raw = getStorageItem(LAST_HIDDEN_KEY);
  if (raw === null) return null;
  const lastHiddenAt = Number(raw);
  return Number.isFinite(lastHiddenAt) ? lastHiddenAt : null;
}
