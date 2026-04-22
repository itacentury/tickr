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
import { reorderLists } from "./data.js";

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
        <li class="item" data-id="${item.id}" style="--i:${index}">
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
            </div>
        </li>
    `,
    )
    .join("");
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
          const displayText =
            entry.action === "item_renamed" && itemText.includes(" \u2192 ")
              ? itemText.split(" \u2192 ")[1]
              : itemText;
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
  dom.editListSort.value = list.itemSort || "alphabetical";
  applyIconSelection(
    dom.editIconOptionsContainer,
    dom.editIconPickerToggle,
    dom.editIconPreview,
    state.editSelectedIcon,
  );
  dom.editListModal.classList.add("open");
  if (window.matchMedia("(hover: hover)").matches) {
    setTimeout(() => dom.editListName.focus(), 100);
  }
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
  dom.editItemModal.classList.add("open");
  if (window.matchMedia("(hover: hover)").matches) {
    setTimeout(() => {
      dom.editItemText.focus();
      dom.editItemText.select();
    }, 100);
  }
}
