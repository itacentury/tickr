/**
 * Safe localStorage wrapper.
 *
 * Falls back to an in-memory store when localStorage is unavailable
 * (private browsing, sandboxed iframe, disabled storage) or throws
 * (quota exceeded). Writes are always mirrored into memory so reads
 * remain consistent after a fallback.
 *
 * This is a leaf node — no imports from other app modules.
 */

/** @type {Map<string, string>} */
const memory = new Map();

/**
 * Read a value, preferring localStorage and falling back to memory.
 *
 * @param {string} key - The storage key.
 * @returns {string|null} The stored value, or null if absent.
 */
export function getStorageItem(key) {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // fall through to memory
  }
  return memory.has(key) ? /** @type {string} */ (memory.get(key)) : null;
}

/**
 * Persist a value; always retained in memory, best-effort to localStorage.
 *
 * @param {string} key - The storage key.
 * @param {string} value - The value to store.
 * @returns {void}
 */
export function setStorageItem(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // memory-only fallback
  }
}

/**
 * Remove a value from both stores.
 *
 * @param {string} key - The storage key.
 * @returns {void}
 */
export function removeStorageItem(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
