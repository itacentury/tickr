/**
 * Shared field-length constraints for RxDB schemas.
 *
 * Mirror of `backend/constants.py`. Both files MUST stay in lockstep — there
 * is no build step that derives one from the other.
 */

export const NAME_MAX = 200;
export const ICON_MAX = 50;
export const TEXT_MAX = 500;
export const ID_MAX = 36;
export const SORT_OPTION_MAX = 50;
export const TIMESTAMP_MAX = 30;
export const COLOR_HEX_MAX = 7;

/**
 * Curated palette for category colors. Tailwind-500 family, picked for
 * legibility on the app's dark background. Keep names purely informational —
 * the canonical value is the hex string.
 */
export const COLOR_PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#64748b",
];
