// @ts-nocheck — DOM-heavy view module: checkJs cannot narrow event.target /
// querySelector results without per-callsite casts.
/**
 * UI rendering functions, drag-and-drop, and modal openers.
 *
 * Responsible for turning application state into DOM updates.
 * User-supplied text is sanitized via escapeHtml() before innerHTML insertion.
 * SVG icon strings are static literals from icons.js.
 */

import { state } from "./state.js";
import * as dom from "./dom.js";
import { icons, uiIcons } from "./icons.js";
import { applyIconSelection } from "./icons.js";
import { groupHistoryByItem, relativeTime } from "./history-model.js";
import { reorderLists, beginCategoryDraft } from "./data.js";
import {
  navigationChanged$,
  itemsChanged$,
  categoriesChanged$,
} from "./bus.js";
import { COLOR_PALETTE } from "./db/constants.js";
import { setDropdownValue } from "./dropdown.js";
import { reportError } from "./error-reporting.js";
import { showErrorToast } from "./toast.js";
import { MODAL_FOCUS_DELAY_MS } from "./timing.js";

/**
 * Wire the view layer to the event bus.
 * Called once during app init, after state.db is ready.
 */
export function initRenderSubscriptions() {
  navigationChanged$.subscribe(() => renderNavigation());
  itemsChanged$.subscribe(() => renderItems());
  categoriesChanged$.subscribe(() => {
    renderEditListCategories();
    renderItemCategoryOptions();
  });
}

/**
 * The category set to render from: the draft when a category-managing modal
 * is open, otherwise the committed categories.
 */
function activeCategories() {
  return state.categoryDraft ?? state.categories;
}

/** Escape HTML entities to prevent XSS in rendered content. */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Toggle the no-lists CSS class on the app container. */
export function updateNoListsState() {
  if (state.lists.length === 0) {
    dom.appContainer.classList.add("no-lists");
  } else {
    dom.appContainer.classList.remove("no-lists");
  }
}

// ---- Navigation rendering ----

/** Render the sidebar navigation list with item counts. */
export function renderNavigation() {
  updateNoListsState();
  const isCustomSort = state.appSettings.list_sort === "custom";

  dom.navList.innerHTML = state.lists
    .map((list) => {
      const remaining = state.itemCounts[list.id] || 0;
      return `
            <li class="nav-item" data-list-id="${list.id}" ${isCustomSort ? 'draggable="true"' : ""}>
                <button class="nav-link ${list.id === state.currentListId ? "active" : ""}"
                        data-id="${list.id}">
                    <span class="nav-icon">${icons[list.icon] || icons.list}</span>
                    <span class="nav-text">${escapeHtml(list.name)}</span>
                    ${remaining > 0 ? `<span class="nav-count">${remaining}</span>` : ""}
                </button>
            </li>
        `;
    })
    .join("");

  if (isCustomSort) {
    setupDragAndDrop();
  }
}

// ---- Drag-and-drop ----

let draggedItem = null;

/** Attach drag-and-drop listeners to nav items. */
function setupDragAndDrop() {
  const navItems = dom.navList.querySelectorAll(".nav-item");
  navItems.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragend", handleDragEnd);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("dragenter", handleDragEnter);
    item.addEventListener("dragleave", handleDragLeave);
    item.addEventListener("drop", handleDrop);
  });
}

function handleDragStart(e) {
  draggedItem = this;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", this.dataset.listId);
}

function handleDragEnd() {
  this.classList.remove("dragging");
  dom.navList.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("drag-over");
  });
  draggedItem = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleDragEnter(e) {
  e.preventDefault();
  if (this !== draggedItem) {
    this.classList.add("drag-over");
  }
}

function handleDragLeave() {
  this.classList.remove("drag-over");
}

async function handleDrop(e) {
  e.preventDefault();
  this.classList.remove("drag-over");
  if (this === draggedItem) return;

  const navItems = Array.from(dom.navList.querySelectorAll(".nav-item"));
  const draggedIndex = navItems.indexOf(draggedItem);
  const dropIndex = navItems.indexOf(this);

  if (draggedIndex < dropIndex) {
    this.parentNode.insertBefore(draggedItem, this.nextSibling);
  } else {
    this.parentNode.insertBefore(draggedItem, this);
  }

  const newOrder = Array.from(dom.navList.querySelectorAll(".nav-item")).map(
    (item) => item.dataset.listId,
  );
  await reorderLists(newOrder);
}

// ---- Items rendering ----

/** Render the items list for the current list. */
export function renderItems() {
  if (state.items.length === 0) {
    dom.itemsList.innerHTML = "";
    dom.emptyState.classList.add("visible");
    const emptyTitle = dom.emptyState.querySelector("p");
    const emptySubtitle = dom.emptyState.querySelector("span");
    if (state.lists.length === 0) {
      emptyTitle.textContent = "No lists available";
      emptySubtitle.textContent = "Create your first list";
    } else {
      emptyTitle.textContent = "This list is empty";
      emptySubtitle.textContent = "Add your first item";
    }
    return;
  }

  dom.emptyState.classList.remove("visible");
  dom.itemsList.innerHTML = state.items
    .map(
      (item, index) => `
        <li class="item" data-id="${item.id}" data-index="${index}">
            <label class="item-checkbox">
                <input type="checkbox">
                <span class="checkmark">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </span>
            </label>
            <div class="item-content">
                <span class="item-text">${escapeHtml(item.text)}</span>
                ${renderCategoryBadge(item.categoryId)}
            </div>
        </li>
    `,
    )
    .join("");

  // CSP-safe stagger: set --i via CSSOM instead of an inline style attribute.
  for (const li of dom.itemsList.children) {
    li.style.setProperty("--i", li.dataset.index);
  }
  applyCatColors(dom.itemsList);
}

// ---- Category badge ----

/**
 * Render a category badge for an item, or empty string if uncategorized.
 *
 * @param {string|null} categoryId
 * @returns {string} HTML snippet
 */
function renderCategoryBadge(categoryId) {
  if (!categoryId) return "";
  const cat = state.categories.find((c) => c.id === categoryId);
  if (!cat) return "";
  const safeColor = sanitizeHexColor(cat.color);
  return `<span class="item-category-badge" data-color="${safeColor}">${escapeHtml(cat.name)}</span>`;
}

/** Strip anything that isn't a 6-digit hex color so it can't break out of the style attr. */
function sanitizeHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#64748b";
}

/**
 * CSP-safe color application: set --cat-color via CSSOM from each element's
 * data-color attribute. The CSP forbids inline style attributes, so colors are
 * carried in data-color and applied here after the HTML is inserted.
 *
 * @param {HTMLElement} root - Container to search within.
 */
function applyCatColors(root) {
  for (const el of root.querySelectorAll("[data-color]")) {
    el.style.setProperty("--cat-color", el.dataset.color);
  }
}

// ---- History ("By item" view) ----

/** Uppercase status badge labels. */
const STATUS_LABEL = { active: "ACTIVE", done: "DONE", deleted: "DELETED" };

/** Verb + node icon per timeline event type. */
const EVENT_VERB = {
  added: "Added",
  completed: "Completed",
  reopened: "Reopened",
  restored: "Restored",
  deleted: "Deleted",
  renamed: "Renamed",
  category: "Category",
};
// View state, local to the By-item drawer.
let historyCards = [];
let historySort = "newest"; // "newest" | "oldest"
const expandedIds = new Set();

/**
 * Fetch history plus the full item set and rebuild the By-item cards.
 *
 * @param {string} listId - The list ID to fetch history for.
 */
export async function fetchHistory(listId) {
  try {
    const response = await fetch(`/api/v1/lists/${listId}/history`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`History request failed with status ${response.status}`);
    }
    const history = await response.json();
    // Full item set incl. completed (RxDB excludes _deleted by default).
    const items = state.db
      ? (await state.db.items.find({ selector: { listId } }).exec()).map((d) =>
          d.toJSON(),
        )
      : [];
    historyCards = groupHistoryByItem(history, items, state.categories, {
      pendingHideIds: state.pendingDeletes.history ?? new Set(),
      pendingDeleteIds: state.pendingDeletes.items,
    });
    renderHistory();
  } catch (error) {
    reportError("fetch history", error);
    showErrorToast("Failed to load history");
    historyCards = [];
    renderHistory();
  }
}

/** Look up a rendered history card by item id (for action handlers). */
export function getHistoryCard(id) {
  return historyCards.find((c) => c.id === id) ?? null;
}

/** Set the By-item sort order and re-render. */
export function setHistorySort(sort) {
  historySort = sort;
  renderHistory();
}

/** Sync the "Expand all" / "Collapse all" toggle label to the current state. */
function updateExpandAllLabel() {
  if (!dom.historyExpandAll) return;
  const cards = visibleCards();
  const allOpen = cards.length > 0 && cards.every((c) => expandedIds.has(c.id));
  dom.historyExpandAll.textContent = allOpen ? "Collapse all" : "Expand all";
}

/** Apply the expanded class + aria-expanded to a live .icard node. */
function applyCardExpansion(el) {
  const open = expandedIds.has(el.dataset.id);
  el.classList.toggle("expanded", open);
  el.querySelector(".icard-head")?.setAttribute("aria-expanded", String(open));
}

/**
 * Toggle a single card's expanded state. Mutates the live DOM node instead of
 * re-rendering so the CSS max-height transition fires.
 */
export function toggleHistoryCard(id) {
  if (expandedIds.has(id)) expandedIds.delete(id);
  else expandedIds.add(id);
  const el = [...dom.historyList.querySelectorAll(".icard")].find(
    (node) => node.dataset.id === id,
  );
  if (!el) {
    renderHistory();
    return;
  }
  applyCardExpansion(el);
  updateExpandAllLabel();
}

/** Expand all cards, or collapse all when every card is already open. */
export function toggleHistoryExpandAll() {
  const cards = visibleCards();
  const allOpen = cards.length > 0 && cards.every((c) => expandedIds.has(c.id));
  expandedIds.clear();
  if (!allOpen) for (const c of cards) expandedIds.add(c.id);
  dom.historyList.querySelectorAll(".icard").forEach(applyCardExpansion);
  updateExpandAllLabel();
}

/** Re-render the drawer from the current cards without re-fetching. */
export function rerenderHistory() {
  renderHistory();
}

/** Earliest activity timestamp for a card (events are newest-first). */
function earliest(card) {
  return card.events[card.events.length - 1].timestamp;
}

/** Cards not currently pending-hidden (optimistic "remove from history"). */
function visibleCards() {
  return historyCards.filter((c) => !state.pendingDeletes.history.has(c.id));
}

/** Return visible cards ordered per the active sort. */
function sortedCards() {
  const cards = visibleCards();
  if (historySort === "oldest") {
    cards.sort((a, b) => earliest(a).localeCompare(earliest(b)));
  } else {
    cards.sort((a, b) => b.lastChanged.localeCompare(a.lastChanged));
  }
  return cards;
}

/**
 * Render a category pill (colored dot + name) or a dashed "No category" pill.
 * The dot color is carried via data-color and applied later by applyCatColors
 * (inline styles are blocked by the CSP).
 */
function catPill(cat, old = false) {
  const cls = `cat-pill${cat ? "" : " none"}${old ? " old" : ""}`;
  if (!cat) {
    return `<span class="${cls}"><span class="cat-pill-dot"></span>No category</span>`;
  }
  const dot = cat.color
    ? `<span class="cat-pill-dot" data-color="${sanitizeHexColor(cat.color)}"></span>`
    : `<span class="cat-pill-dot"></span>`;
  return `<span class="${cls}">${dot}${escapeHtml(cat.name)}</span>`;
}

/** Render one mini-timeline row for a single event. */
function renderEvent(event) {
  let transition = "";
  if (event.type === "renamed" && event.after !== undefined) {
    transition = `<span class="mini-transition">${escapeHtml(event.before || "")} \u2192 ${escapeHtml(event.after || "")}</span>`;
  } else if (event.type === "category") {
    const to = catPill(event.toCat ?? null);
    transition =
      event.fromCat !== undefined
        ? `<span class="mini-transition">${catPill(event.fromCat, true)}<span class="mini-arrow">\u2192</span>${to}</span>`
        : `<span class="mini-transition">${to}</span>`;
  }
  return `<div class="mini-event ${event.type}">
      <span class="mini-node"></span>
      <div class="mini-body">
        <span class="mini-verb">${EVENT_VERB[event.type]}</span>
        ${transition}
      </div>
      <span class="mini-time">${relativeTime(event.timestamp)}</span>
    </div>`;
}

/** Render the status-dependent action row (done/deleted only). */
function renderActions(card) {
  if (card.status === "active") return "";
  const primary =
    card.status === "deleted"
      ? { action: "restore", label: "Restore" }
      : { action: "reopen", label: "Reopen" };
  return `<div class="icard-actions">
      <button type="button" class="act-btn primary" data-action="${primary.action}">
        ${uiIcons.undo}<span>${primary.label}</span>
      </button>
      <button type="button" class="act-btn danger" data-action="remove">
        ${uiIcons.trash}<span>Remove from history</span>
      </button>
    </div>`;
}

/** Render a single item card. */
function renderCard(card) {
  const open = expandedIds.has(card.id);
  const events =
    historySort === "oldest" ? [...card.events].reverse() : card.events;

  let categoryTag = "";
  if (card.category) {
    const dot = card.accent
      ? `<span class="cat-dot" data-color="${sanitizeHexColor(card.accent)}"></span>`
      : "";
    categoryTag = `<span class="icard-divider"></span><span class="cat-tag">${dot}${escapeHtml(card.category.name)}</span>`;
  }

  return `<div class="icard ${card.status}${open ? " expanded" : ""}" data-id="${escapeHtml(card.id)}">
      <div class="icard-head" role="button" tabindex="0" aria-expanded="${open}">
        <div class="icard-main">
          <div class="icard-name">${escapeHtml(card.name)}</div>
          <div class="icard-sub">
            <span class="status ${card.status}">${STATUS_LABEL[card.status]}</span>
            ${categoryTag}
          </div>
        </div>
        <div class="icard-meta">
          <span class="icard-time">${relativeTime(card.lastChanged)}</span>
          <span class="chevron">${uiIcons.chevron}</span>
        </div>
      </div>
      <div class="icard-body">
        <div class="icard-body-inner">
          <div class="mini">${events.map(renderEvent).join("")}</div>
          ${renderActions(card)}
        </div>
      </div>
    </div>`;
}

/** Render the By-item card list (or the empty state) and sync the controls. */
function renderHistory() {
  const cards = sortedCards();
  updateExpandAllLabel();
  if (dom.historySort) {
    dom.historySort.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === historySort);
    });
  }

  if (cards.length === 0) {
    dom.historyList.innerHTML = '<div class="empty">No history to show.</div>';
    return;
  }
  dom.historyList.innerHTML = cards.map(renderCard).join("");
  applyCatColors(dom.historyList);
}

// ---- Modal openers ----

/** Open the edit list modal populated with the current list's data. */
export function openEditListModal() {
  const list = state.lists.find((l) => l.id === state.currentListId);
  if (!list) return;
  dom.editListName.value = list.name;
  state.editSelectedIcon = list.icon || "list";
  setDropdownValue(dom.editListSortDropdown, list.itemSort || "alphabetical");
  applyIconSelection(
    dom.editIconOptionsContainer,
    dom.editIconPickerToggle,
    dom.editIconPreview,
    state.editSelectedIcon,
  );
  beginCategoryDraft();
  renderEditListCategories();
  resetCategoryForm(dom.editListCategoryForm);
  dom.editListModal.classList.add("open");
  if (window.matchMedia("(hover: hover)").matches) {
    setTimeout(() => dom.editListName.focus(), MODAL_FOCUS_DELAY_MS);
  }
}

/** Render the categories list inside the edit-list modal. */
export function renderEditListCategories() {
  if (!dom.editListCategoriesList) return;
  const cats = activeCategories();
  if (cats.length === 0) {
    dom.editListCategoriesList.innerHTML =
      '<li class="categories-empty">No categories yet</li>';
    return;
  }
  dom.editListCategoriesList.innerHTML = cats
    .map((cat) => {
      const color = sanitizeHexColor(cat.color);
      return `<li class="category-row" data-id="${cat.id}">
        <span class="category-dot" data-color="${color}"></span>
        <span class="category-name">${escapeHtml(cat.name)}</span>
        <button type="button" class="btn-icon-mini category-edit" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button type="button" class="btn-icon-mini category-delete" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
          </svg>
        </button>
      </li>`;
    })
    .join("");
  applyCatColors(dom.editListCategoriesList);
}

/** Render the category dropdown menu inside the edit-item modal. */
export function renderItemCategoryOptions() {
  const wrapper = dom.editItemCategoryDropdown;
  if (!wrapper) return;
  const menu = wrapper.querySelector(".dropdown-menu");
  const current = dom.editItemCategory.value;
  const cats = activeCategories();
  const entries = [{ id: "", name: "(no category)", color: null }].concat(
    cats.map((c) => ({ id: c.id, name: c.name, color: c.color })),
  );
  menu.innerHTML = entries
    .map((e) => {
      const dot =
        e.color === null
          ? '<span class="dropdown-dot dropdown-dot--empty"></span>'
          : `<span class="dropdown-dot" data-color="${sanitizeHexColor(e.color)}"></span>`;
      return `<li class="dropdown-item" role="option" data-value="${e.id}">${dot}<span class="dropdown-item-label">${escapeHtml(e.name)}</span></li>`;
    })
    .join("");
  applyCatColors(menu);
  // Restore selection if it still exists, else fall back to "(no category)".
  const keep = cats.some((c) => c.id === current) ? current : "";
  setDropdownValue(wrapper, keep);
}

/**
 * Build the palette swatches inside a container element.
 *
 * @param {HTMLElement} container - The .color-picker element to populate.
 * @param {string} selected - Currently selected hex.
 */
export function renderColorPalette(container, selected) {
  if (!container) return;
  container.querySelectorAll(".color-swatch").forEach((el) => el.remove());
  const html = COLOR_PALETTE.map(
    (c) =>
      `<button type="button" class="color-swatch${c === selected ? " selected" : ""}" data-color="${c}" aria-label="${c}"></button>`,
  ).join("");
  container.insertAdjacentHTML("afterbegin", html);
  applyCatColors(container);
}

/** Reset a category-form region to a clean collapsed state. */
export function resetCategoryForm(formEl) {
  if (!formEl) return;
  formEl.classList.remove("expanded");
  state.editingCategoryId = null;
}

/**
 * Open the edit item modal for a specific item.
 *
 * @param {string} itemId - The item ID to edit.
 * @param {string} text - The current item text.
 */
export function openEditItemModal(itemId, text) {
  state.editingItemId = itemId;
  dom.editItemText.value = text;
  const item = state.items.find((i) => i.id === itemId);
  dom.editItemCategory.value = item?.categoryId || "";
  beginCategoryDraft();
  renderItemCategoryOptions();
  resetCategoryForm(dom.editItemCategoryQuickForm);
  dom.editItemModal.classList.add("open");
  if (window.matchMedia("(hover: hover)").matches) {
    setTimeout(() => {
      dom.editItemText.focus();
      dom.editItemText.select();
    }, MODAL_FOCUS_DELAY_MS);
  }
}
