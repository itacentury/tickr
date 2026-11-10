/**
 * Default-list helpers: decide whether the app has been idle long enough to
 * reopen the user's default list instead of the last viewed one.
 *
 * The default list id and the idle timeout come from the server settings
 * (`default_list_id`, `default_list_timeout_minutes`); the moment the app went
 * to the background is kept per device in storage.
 */

import { getStorageItem, setStorageItem } from "../storage.js";

const LAST_HIDDEN_KEY = "tickr_last_hidden_at";
const FALLBACK_TIMEOUT_MINUTES = 30;
const MIN_TIMEOUT_MINUTES = 1;
const MS_PER_MINUTE = 60_000;

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
 * Read the idle timeout from settings, falling back when absent or invalid.
 * Values below one minute are clamped so a quick app switch never counts
 * as idle.
 *
 * @param {Record<string, string>} settings - Server settings.
 * @returns {number} Timeout in minutes.
 */
export function getIdleTimeoutMinutes(settings) {
  const raw = settings.default_list_timeout_minutes;
  // `Number(" ")` is 0, so blank strings must be rejected before parsing.
  if (raw === undefined || raw.trim() === "") return FALLBACK_TIMEOUT_MINUTES;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes)) return FALLBACK_TIMEOUT_MINUTES;
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
  setStorageItem(LAST_HIDDEN_KEY, String(now));
}

/**
 * Whether the app has been idle long enough to reopen the default list.
 *
 * @param {Record<string, string>} settings - Server settings.
 * @param {number} [now] - Epoch ms; defaults to the current time.
 * @returns {boolean}
 */
export function isAppIdle(settings, now = Date.now()) {
  const raw = getStorageItem(LAST_HIDDEN_KEY);
  const lastHiddenAt = raw === null ? null : Number(raw);
  const validLastHiddenAt = Number.isFinite(lastHiddenAt) ? lastHiddenAt : null;
  return isIdleExpired(validLastHiddenAt, now, getIdleTimeoutMinutes(settings));
}
