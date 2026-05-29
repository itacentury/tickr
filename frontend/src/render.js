/**
 * UI rendering functions, drag-and-drop, and modal openers.
 *
 * Responsible for turning application state into DOM updates.
 * User-supplied text is sanitized via escapeHtml() before innerHTML insertion.
 * SVG icon strings are static literals from icons.js.
 */

import { state } from "./state.js";
import * as dom from "./dom.js";
import { icons } from "./icons.js";
import { applyIconSelection } from "./icons.js";
import { reorderLists, beginCategoryDraft } from "./data.js";
import {
  navigationChanged$,
  itemsChanged$,
  categoriesChanged$,
} from "./bus.js";
import { COLOR_PALETTE } from "./db/constants.js";
import { setDropdownValue } from "./dropdown.js";

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
  return `<span class="item-category-badge" style="--cat-color:${safeColor}">${escapeHtml(cat.name)}</span>`;
}

/** Strip anything that isn't a 6-digit hex color so it can't break out of the style attr. */
function sanitizeHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#64748b";
}

// ---- History ----

/**
 * Fetch and render history from the server.
 *
 * @param {string} listId - The list ID to fetch history for.
 */
export async function fetchHistory(listId) {
  try {
    const response = await fetch(`/api/v1/lists/${listId}/history`, {
      cache: "no-store",
    });
    const history = await response.json();
    renderHistory(history);
  } catch {
    renderHistory([]);
  }
}

/** Render history entries grouped by date. */
function renderHistory(history) {
  if (history.length === 0) {
    dom.historyList.innerHTML =
      '<li class="history-empty">No activities yet</li>';
    return;
  }

  const actionLabels = {
    item_created: { text: "Added", class: "created" },
    item_completed: { text: "Completed", class: "completed" },
    item_uncompleted: { text: "Reopened", class: "uncompleted" },
    item_deleted: { text: "Deleted", class: "deleted" },
    item_renamed: { text: "Renamed", class: "renamed" },
    item_category_changed: { text: "Category changed", class: "renamed" },
    list_created: { text: "List created", class: "list" },
    list_renamed: { text: "List renamed", class: "list" },
    list_icon_changed: { text: "Icon changed", class: "list" },
    list_sort_changed: { text: "Sort changed", class: "list" },
  };

  function getDateGroup(timestamp) {
    const date = new Date(timestamp);
    const todayDate = new Date();
    const today = new Date(
      todayDate.getFullYear(),
      todayDate.getMonth(),
      todayDate.getDate(),
    );
    const entryDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const diffDays = Math.round((today - entryDate) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  const groups = [];
  let currentGroup = null;
  for (const entry of history) {
    const label = getDateGroup(entry.timestamp);
    if (!currentGroup || currentGroup.label !== label) {
      currentGroup = { label, entries: [] };
      groups.push(currentGroup);
    }
    currentGroup.entries.push(entry);
  }

  dom.historyList.innerHTML = groups
    .map((group) => {
      const entries = group.entries
        .map((entry) => {
          const action = actionLabels[entry.action] || {
            text: entry.action,
            class: "",
          };
          const itemText = entry.item_text || "";
          let displayText = itemText;
          if (entry.action === "item_renamed" && itemText.includes(" \u2192 ")) {
            displayText = itemText.split(" \u2192 ")[1];
          } else if (entry.action === "item_category_changed") {
            const cat = state.categories.find((c) => c.id === itemText);
            displayText = cat ? cat.name : itemText ? "\u2014" : "(none)";
          }
          const shortId = entry.item_id ? entry.item_id.slice(0, 6) : "";
          const idBadge = shortId
            ? `<span class="history-id" title="${escapeHtml(entry.item_id)}">${escapeHtml(shortId)}</span>`
            : "";
          return `<li class="history-entry">
            <span class="history-time">${formatTime(entry.timestamp)}</span>
            <span class="action-type ${action.class}">${action.text}</span>
            ${idBadge}
            <span class="history-text">${escapeHtml(displayText)}</span>
          </li>`;
        })
        .join("");
      return `<li class="history-group">
        <div class="history-date-header">${group.label}</div>
        <ul class="history-entries">${entries}</ul>
      </li>`;
    })
    .join("");
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
    setTimeout(() => dom.editListName.focus(), 100);
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
        <span class="category-dot" style="--cat-color:${color}"></span>
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
          : `<span class="dropdown-dot" style="--cat-color:${e.color}"></span>`;
      return `<li class="dropdown-item" role="option" data-value="${e.id}">${dot}<span class="dropdown-item-label">${escapeHtml(e.name)}</span></li>`;
    })
    .join("");
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
      `<button type="button" class="color-swatch${c === selected ? " selected" : ""}" data-color="${c}" style="--cat-color:${c}" aria-label="${c}"></button>`,
  ).join("");
  container.insertAdjacentHTML("afterbegin", html);
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
    }, 100);
  }
}
