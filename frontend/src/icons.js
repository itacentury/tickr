/**
 * SVG icon registry and icon picker helpers.
 *
 * Leaf node — no imports from other app modules.
 * SVG markup lives in `icons/*.svg` (list icons) and `icons/ui/*.svg`
 * (action icons) and is inlined at build time via Vite's `?raw` glob import.
 * All SVG content is static, not user-supplied — safe for innerHTML.
 */

const rawIcons = import.meta.glob("./icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});
const rawUiIcons = import.meta.glob("./icons/ui/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * Rewrite hardcoded `stroke`/`fill` colors to `currentColor` so inlined markup
 * inherits the theme color at runtime.
 *
 * Source files use a visible placeholder color (by convention `#808080`) on
 * their `stroke`/`fill` so they render when opened standalone in an editor; the
 * exact source color is not load-bearing. Tolerates whitespace around `=` and
 * single- or double-quoted values, and matches values spanning multiple lines.
 * `fill="none"` and existing `currentColor` are left intact; output is
 * normalized to double quotes.
 *
 * @param {string} svg - Raw SVG markup.
 * @returns {string} Themed SVG markup.
 */
export function themeSvgColors(svg) {
  return svg.replace(
    /(?<![\w-])(stroke|fill)\s*=\s*(["'])(?!(?:none|currentColor)\2)[^"']*\2/g,
    '$1="currentColor"',
  );
}

/**
 * Build a key→SVG map from a glob result, deriving each key from the file name.
 *
 * @param {Record<string, unknown>} globResult - Vite glob import result.
 * @returns {Map<string, string>} Map of icon key to SVG markup.
 */
function svgMapFromGlob(globResult) {
  const map = new Map();
  for (const [path, svg] of Object.entries(globResult)) {
    const key = path.slice(path.lastIndexOf("/") + 1, -".svg".length);
    map.set(key, themeSvgColors(/** @type {string} */ (svg)));
  }
  return map;
}

/**
 * Look up an icon SVG by key, throwing if no source file produced it.
 *
 * Guards build/load so a key without a matching `<key>.svg` surfaces as an
 * immediate error instead of a silent `undefined` in the icon map.
 *
 * @param {Map<string, string>} map - Key→SVG map from `svgMapFromGlob`.
 * @param {string} key - Icon key expected to have a `<key>.svg` source file.
 * @param {string} kind - Icon-group label used in the error message.
 * @returns {string} Themed SVG markup.
 */
export function requireSvg(map, key, kind) {
  const svg = map.get(key);
  if (svg === undefined) {
    throw new Error(`Missing ${kind} SVG for "${key}" (expected ${key}.svg)`);
  }
  return svg;
}

const listIconSvgByKey = svgMapFromGlob(rawIcons);
const uiIconSvgByKey = svgMapFromGlob(rawUiIcons);

/**
 * Display labels for each list icon key. Also the source of truth for the
 * icon picker order — `icons` is built by iterating these keys.
 */
export const iconLabels = {
  list: "List",
  cart: "Shopping",
  check: "Tasks",
  lightbulb: "Ideas",
  star: "Important",
  heart: "Favorites",
  home: "Home",
  briefcase: "Work",
  book: "Books",
  film: "Film",
  server: "Server",
  disc: "Vinyl",
  shoppingBag: "Shopping Bag",
  package: "Package",
  tool: "Household",
  tv: "Media",
  activity: "Activity",
  calendar: "Calendar",
  clock: "Clock",
  music: "Music",
  camera: "Camera",
  gift: "Gift",
  plane: "Travel",
  coffee: "Coffee",
  gamepad: "Gaming",
  graduation: "Education",
  shirt: "Clothing",
  palette: "Art",
  utensils: "Food",
  mail: "Mail",
  phone: "Phone",
  globe: "World",
  headphones: "Podcasts",
  key: "Security",
  mapPin: "Places",
  pencil: "Notes",
  users: "People",
  zap: "Priority",
  cloud: "Cloud",
  flag: "Goals",
  bell: "Reminders",
  compass: "Explore",
  smile: "Mood",
  target: "Focus",
  sun: "Outdoors",
};

/**
 * Extra search terms per icon key, so the picker search matches words that are
 * neither the key nor the display label (e.g. "groceries" → cart). Keys without
 * an entry are still searchable by their key and label.
 */
export const iconKeywords = {
  list: ["lines", "items"],
  cart: ["buy", "groceries", "shop", "supermarket"],
  check: ["todo", "done", "complete", "task"],
  lightbulb: ["idea", "inspiration", "light"],
  star: ["favorite", "important", "rating"],
  heart: ["love", "like", "favorite"],
  home: ["house"],
  briefcase: ["job", "business", "office"],
  book: ["reading", "library", "notebook"],
  film: ["movie", "cinema", "video"],
  server: ["hosting", "database", "backend"],
  disc: ["record", "album", "cd", "vinyl"],
  shoppingBag: ["bag", "buy", "purchase"],
  package: ["box", "delivery", "parcel"],
  tool: ["repair", "fix", "diy", "household", "wrench"],
  tv: ["television", "screen", "media"],
  activity: ["pulse", "fitness", "health", "heartbeat"],
  calendar: ["date", "schedule", "events"],
  clock: ["time", "alarm"],
  music: ["song", "audio", "note"],
  camera: ["photo", "picture"],
  gift: ["present", "birthday"],
  plane: ["flight", "vacation", "trip", "travel"],
  coffee: ["drink", "cafe", "tea"],
  gamepad: ["game", "controller", "gaming"],
  graduation: ["school", "study", "learn", "university"],
  shirt: ["clothes", "fashion", "wardrobe"],
  palette: ["paint", "color", "design", "creative", "art"],
  utensils: ["eat", "meal", "restaurant", "cooking", "dinner", "food"],
  mail: ["email", "envelope", "message"],
  phone: ["call", "mobile", "contact"],
  globe: ["earth", "international", "web", "world"],
  headphones: ["podcast", "listen", "audio"],
  key: ["password", "login", "access", "security"],
  mapPin: ["location", "map", "address", "pin", "place"],
  pencil: ["edit", "write", "draw", "note"],
  users: ["team", "group", "contacts", "friends", "people"],
  zap: ["urgent", "energy", "fast", "lightning", "priority"],
  cloud: ["weather", "storage", "sky"],
  flag: ["goal", "milestone", "country"],
  bell: ["notification", "reminder", "alert"],
  compass: ["navigate", "discover", "direction", "explore"],
  smile: ["happy", "emoji", "feeling", "mood"],
  target: ["aim", "objective", "focus", "dart"],
  sun: ["weather", "outdoor", "summer", "day"],
};

/** SVG markup keyed by icon name, ordered to match `iconLabels`. */
export const icons = Object.fromEntries(
  Object.keys(iconLabels).map((key) => [
    key,
    requireSvg(listIconSvgByKey, key, "list icon"),
  ]),
);

/**
 * UI/action icons used by the history "By item" view (timeline nodes and
 * action buttons). Kept separate from `icons` so they never appear in the
 * list icon picker, which iterates `icons`.
 */
export const uiIcons = Object.fromEntries(uiIconSvgByKey);

/**
 * Populate an icon picker's grid with icon option buttons.
 *
 * Renders into the container's `.icon-grid` child (not the container itself) so
 * the sibling search input and no-results node survive. Each button stores its
 * lower-cased searchable text (key + label + keywords) in `data-search`, so the
 * search filter never has to recompute it per keystroke.
 *
 * All SVG content is from the static `icons` map above — safe for innerHTML.
 *
 * @param {HTMLElement} container - The icon-options container.
 */
export function populateIconPicker(container) {
  const grid = /** @type {HTMLElement} */ (
    container.querySelector(".icon-grid")
  );
  grid.innerHTML = "";
  for (const [key, svg] of Object.entries(icons)) {
    const label = iconLabels[key] || key;
    const keywords = iconKeywords[key] || [];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-option";
    btn.dataset.icon = key;
    btn.dataset.search = `${key} ${label} ${keywords.join(" ")}`.toLowerCase();
    btn.title = label;
    btn.innerHTML = svg;
    grid.appendChild(btn);
  }
}

/**
 * Filter an icon picker's options against a search query.
 *
 * Hides options whose `data-search` text does not contain the query and toggles
 * the `.icon-no-results` message. An empty query restores the full grid.
 *
 * @param {HTMLElement} container - The icon-options container.
 * @param {string} query - The raw search input value.
 */
export function filterIconPicker(container, query) {
  const grid = /** @type {HTMLElement | null} */ (
    container.querySelector(".icon-grid")
  );
  const normalized = query.trim().toLowerCase();
  // Capture the height before the layout collapses so we can tween from it.
  const startHeight = grid ? grid.offsetHeight : 0;

  let visibleCount = 0;
  container.querySelectorAll(".icon-option").forEach((opt) => {
    const el = /** @type {HTMLElement} */ (opt);
    const hidden = normalized !== "" && !el.dataset.search.includes(normalized);
    el.hidden = hidden;
    if (!hidden) visibleCount += 1;
  });
  const noResults = /** @type {HTMLElement} */ (
    container.querySelector(".icon-no-results")
  );
  if (noResults) noResults.hidden = visibleCount > 0;

  // The grid height tween is only visible while the picker is expanded; skip it
  // when collapsed (e.g. applyIconSelection / resetSearch on a closed picker) so
  // we don't animate an off-screen grid.
  if (grid && container.classList.contains("expanded")) {
    animateGridHeight(grid, startHeight, visibleCount);
  }
}

/**
 * Compute the grid's settled height for a given number of visible options.
 *
 * Derived from the row count rather than measured, so the still-fading
 * (`allow-discrete`) options that linger in layout do not skew the result.
 *
 * @param {HTMLElement} grid - The `.icon-grid` element.
 * @param {number} visibleCount - Number of options that remain visible.
 * @returns {number} The target height in pixels.
 */
function naturalGridHeight(grid, visibleCount) {
  if (visibleCount === 0) return 0;
  const cells = /** @type {NodeListOf<HTMLElement>} */ (
    grid.querySelectorAll(".icon-option:not([hidden])")
  );
  const sample = cells[0];
  if (!sample) return 0;
  const style = getComputedStyle(grid);
  const gap = parseFloat(style.rowGap) || 0;
  // Derive columns from layout (cells sharing the first row's offsetTop) rather
  // than parsing gridTemplateColumns, which can carry multi-token track functions.
  const firstRowTop = sample.offsetTop;
  let columns = 0;
  cells.forEach((cell) => {
    if (cell.offsetTop === firstRowTop) columns += 1;
  });
  const cellHeight = sample.offsetHeight; // square cells (aspect-ratio: 1)
  const rows = Math.ceil(visibleCount / columns);
  const maxHeight = parseFloat(style.maxHeight) || Infinity;
  return Math.min(rows * cellHeight + (rows - 1) * gap, maxHeight);
}

/**
 * Tween the grid (and thus the modal) between its old and new height.
 *
 * @param {HTMLElement} grid - The `.icon-grid` element.
 * @param {number} startHeight - Height before the filter changed.
 * @param {number} visibleCount - Number of options that remain visible.
 */
function animateGridHeight(grid, startHeight, visibleCount) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const endHeight = naturalGridHeight(grid, visibleCount);
  if (Math.round(startHeight) === Math.round(endHeight)) return;
  // Web Animations API is absent in some environments (e.g. jsdom); skip the
  // tween gracefully rather than throwing.
  if (typeof grid.animate !== "function") return;
  // Cancel any in-flight run so rapid typing stays smooth.
  grid.getAnimations().forEach((animation) => animation.cancel());
  grid.animate([{ height: `${startHeight}px` }, { height: `${endHeight}px` }], {
    duration: 200,
    easing: "ease",
  });
}

/**
 * Update the icon preview in the toggle button.
 *
 * @param {HTMLElement} previewElement - The preview container element.
 * @param {string} iconKey - The icon key from the icons object.
 */
export function updateIconPreview(previewElement, iconKey) {
  if (previewElement && icons[iconKey]) {
    previewElement.innerHTML = icons[iconKey];
  }
}

/**
 * Apply an icon selection to a picker: update preview, mark the matching
 * option as selected, and collapse the toggle/options panel.
 *
 * @param {HTMLElement} container - The icon-options container.
 * @param {HTMLElement} toggle - The picker toggle button.
 * @param {HTMLElement} preview - The preview element inside the toggle.
 * @param {string} iconKey - The icon key to select.
 */
export function applyIconSelection(container, toggle, preview, iconKey) {
  updateIconPreview(preview, iconKey);
  container.querySelectorAll(".icon-option").forEach((opt) => {
    const el = /** @type {HTMLElement} */ (opt);
    el.classList.toggle("selected", el.dataset.icon === iconKey);
  });
  toggle.classList.remove("open");
  container.classList.remove("expanded");
  const search = /** @type {HTMLInputElement | null} */ (
    container.querySelector(".icon-search")
  );
  if (search) search.value = "";
  filterIconPicker(container, "");
}
