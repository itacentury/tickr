/**
 * Pure transforms for the "By item" history view.
 *
 * Builds one card per to-do item from the flat history event stream plus the
 * live item/category state, and formats relative timestamps. This is a leaf
 * module — no imports from other app modules and no DOM access — so it can be
 * unit-tested without jsdom.
 */

/**
 * @typedef {Object} HistoryEvent
 * @property {string|null} item_id - Item the event belongs to (null for list events).
 * @property {string} action - Backend action, e.g. "item_created".
 * @property {string|null} item_text - Action payload (name, "old → new", category id).
 * @property {string} timestamp - ISO timestamp.
 */

/**
 * @typedef {Object} TimelineEvent
 * @property {string} type - Mapped event type (added/completed/reopened/restored/deleted/renamed/category).
 * @property {string} timestamp - ISO timestamp.
 * @property {string|null} [before] - Previous value (renames only).
 * @property {string|null} [after] - New value (renames and category changes).
 */

/**
 * @typedef {Object} ItemCard
 * @property {string} id
 * @property {string} name
 * @property {"active"|"done"|"deleted"} status
 * @property {{name: string, color: string}|null} category
 * @property {string|null} accent - Category color, or null when none/unknown.
 * @property {string} lastChanged - ISO timestamp of the most recent event.
 * @property {TimelineEvent[]} events - Newest-first.
 */

const RENAME_SEPARATOR = " → "; // "old → new"

/** Maps backend history actions to timeline event types. */
const ACTION_TO_TYPE = {
  item_created: "added",
  item_completed: "completed",
  item_uncompleted: "reopened",
  item_restored: "restored",
  item_deleted: "deleted",
  item_renamed: "renamed",
  item_category_changed: "category",
};

/**
 * Map a single history row to a timeline event, resolving rename/category payloads.
 *
 * @param {HistoryEvent} event
 * @param {Map<string, {name: string, color: string}>} categoriesById
 * @returns {TimelineEvent|null} Null when the action is not item-scoped.
 */
function toTimelineEvent(event, categoriesById) {
  const type = ACTION_TO_TYPE[event.action];
  if (!type) return null;

  const mapped = { type, timestamp: event.timestamp };
  const text = event.item_text || "";

  if (type === "renamed" && text.includes(RENAME_SEPARATOR)) {
    const [before, after] = text.split(RENAME_SEPARATOR);
    mapped.before = before;
    mapped.after = after;
  } else if (type === "category") {
    // item_text holds the new category id ("" means "none").
    mapped.after = text ? (categoriesById.get(text)?.name ?? text) : null;
  }
  return mapped;
}

/**
 * Derive the current name for an item from its live doc or, failing that, its
 * history (latest rename's new side, else latest creation text).
 *
 * @param {Object|undefined} liveItem
 * @param {HistoryEvent[]} rawEvents - This item's raw history rows, newest-first.
 * @returns {string}
 */
function deriveName(liveItem, rawEvents) {
  if (liveItem) return liveItem.text;
  const rename = rawEvents.find((e) => e.action === "item_renamed");
  if (rename?.item_text?.includes(RENAME_SEPARATOR)) {
    return rename.item_text.split(RENAME_SEPARATOR)[1];
  }
  const added = rawEvents.find((e) => e.action === "item_created");
  return added?.item_text ?? "(unknown)";
}

/**
 * Resolve an item's category and accent colour, preferring the live doc and
 * falling back to the latest category-change event. A category id that no
 * longer resolves yields a neutral (null) accent rather than throwing.
 *
 * @param {Object|undefined} liveItem
 * @param {HistoryEvent[]} rawEvents - This item's raw history rows, newest-first.
 * @param {Map<string, {name: string, color: string}>} categoriesById
 * @returns {{category: {name: string, color: string}|null, accent: string|null}}
 */
function deriveCategory(liveItem, rawEvents, categoriesById) {
  let categoryId = liveItem?.categoryId ?? null;
  if (!liveItem) {
    const change = rawEvents.find((e) => e.action === "item_category_changed");
    categoryId = change?.item_text || null;
  }
  if (!categoryId) return { category: null, accent: null };

  const category = categoriesById.get(categoryId) ?? null;
  return { category, accent: category?.color ?? null };
}

/**
 * Build the "By item" cards from history events and live state.
 *
 * @param {HistoryEvent[]} events - Flat history rows, newest-first (as returned by the API).
 * @param {Object[]} items - Full live item set for the list (incl. completed, excl. soft-deleted).
 * @param {Object[]} categories - Category docs ({id, name, color}).
 * @param {{pendingHideIds?: Set<string>, pendingDeleteIds?: Set<string>}} [options]
 * @returns {ItemCard[]} Cards ordered by most recent activity first.
 */
export function groupHistoryByItem(events, items, categories, options = {}) {
  const pendingHideIds = options.pendingHideIds ?? new Set();
  const pendingDeleteIds = options.pendingDeleteIds ?? new Set();

  const itemsById = new Map(items.map((it) => [it.id, it]));
  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  // Group raw history rows by item, dropping list-level and orphaned (null
  // item_id) rows. Input order (newest-first) is preserved per item.
  const rawByItem = new Map();
  for (const event of events) {
    if (!event.item_id || !ACTION_TO_TYPE[event.action]) continue;
    if (!rawByItem.has(event.item_id)) rawByItem.set(event.item_id, []);
    rawByItem.get(event.item_id).push(event);
  }

  // Every live item gets a card even if its history was purged.
  const itemIds = new Set([...rawByItem.keys(), ...itemsById.keys()]);

  const cards = [];
  for (const id of itemIds) {
    if (pendingHideIds.has(id)) continue;

    const liveItem = itemsById.get(id);
    const rawEvents = rawByItem.get(id) ?? [];
    const timeline = rawEvents
      .map((e) => toTimelineEvent(e, categoriesById))
      .filter((e) => e !== null);

    // A live item with no history still renders via a synthetic "added" event.
    if (timeline.length === 0 && liveItem) {
      const ts = liveItem.createdAt ?? liveItem.updatedAt;
      timeline.push({ type: "added", timestamp: ts });
    }
    if (timeline.length === 0) continue;

    /** @type {"active"|"done"|"deleted"} */
    let status;
    if (liveItem && !pendingDeleteIds.has(id)) {
      status = liveItem.completed ? "done" : "active";
    } else {
      status = "deleted";
    }

    const { category, accent } = deriveCategory(
      liveItem,
      rawEvents,
      categoriesById,
    );

    cards.push({
      id,
      name: deriveName(liveItem, rawEvents),
      status,
      category,
      accent,
      lastChanged: timeline[0].timestamp,
      events: timeline,
    });
  }

  cards.sort((a, b) => b.lastChanged.localeCompare(a.lastChanged));
  return cards;
}

/**
 * Format a timestamp relative to now: "just now", "23m ago", "2h ago", or an
 * absolute "30 May" once older than 24 hours.
 *
 * @param {string} timestamp - ISO timestamp.
 * @param {number} [nowMs] - Reference time in ms (defaults to Date.now()), for testing.
 * @returns {string}
 */
export function relativeTime(timestamp, nowMs = Date.now()) {
  const then = new Date(timestamp).getTime();
  const diffSec = Math.max(0, Math.round((nowMs - then) / 1000));

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
