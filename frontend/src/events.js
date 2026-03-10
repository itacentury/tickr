/**
 * Event listener wiring for the entire application.
 *
 * Exports a single setupEventListeners() function that attaches all
 * DOM event handlers. Called once during initialization.
 *
 * Note: .exec() calls below are RxDB query execution, not shell commands.
 */

import { state } from "./state.js";
import * as dom from "./dom.js";
import { populateIconPicker, updateIconPreview } from "./icons.js";
import {
  createList,
  updateList,
  deleteList,
  createItem,
  updateItem,
  deleteItem,
  updateSettings,
  selectList,
  now,
} from "./data.js";
import { openEditListModal, fetchHistory } from "./render.js";
import { showUndoToast, showErrorToast, initToastListeners } from "./toast.js";
import { openMetrics, closeMetrics } from "./metrics.js";
import { reportError } from "./error-reporting.js";

/** Attach all application event listeners. */
export function setupEventListeners() {
  // Populate icon pickers
  populateIconPicker(dom.iconOptionsContainer);
  populateIconPicker(dom.editIconOptionsContainer);

  // Toast interaction listeners
  initToastListeners();

  // Sidebar toggle
  dom.sidebarToggle.addEventListener("click", () => {
    dom.sidebar.classList.toggle("collapsed");
    localStorage.setItem(
      "sidebarCollapsed",
      dom.sidebar.classList.contains("collapsed"),
    );
  });

  dom.mobileMenuBtn.addEventListener("click", dom.openMobileMenu);

  dom.overlay.addEventListener("click", () => {
    dom.closeMobileMenu();
    dom.historyPanel.classList.remove("open");
    dom.overlay.classList.remove("visible");
  });

  // Icon pickers
  dom.iconPickerToggle.addEventListener("click", () => {
    dom.iconPickerToggle.classList.toggle("open");
    dom.iconOptionsContainer.classList.toggle("expanded");
  });

  dom.editIconPickerToggle.addEventListener("click", () => {
    dom.editIconPickerToggle.classList.toggle("open");
    dom.editIconOptionsContainer.classList.toggle("expanded");
  });

  // Add item
  dom.addItemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = dom.addItemInput.value.trim();
    if (text && state.currentListId) {
      await createItem(text);
      dom.addItemInput.value = "";
    }
  });

  // History
  dom.historyBtn.addEventListener("click", () => {
    if (state.currentListId) {
      fetchHistory(state.currentListId);
      dom.historyPanel.classList.add("open");
      dom.overlay.classList.add("visible");
    }
  });

  dom.closeHistoryBtn.addEventListener("click", () => {
    dom.historyPanel.classList.remove("open");
    dom.overlay.classList.remove("visible");
  });

  // Edit list
  dom.editListBtn.addEventListener("click", openEditListModal);

  // Delete list (with undo)
  dom.deleteListBtn.addEventListener("click", async () => {
    dom.editListModal.classList.remove("open");
    if (!state.currentListId || state.lists.length === 0) return;
    const list = state.lists.find((l) => l.id === state.currentListId);
    if (!list) return;
    const listName = list.name;
    const listIcon = list.icon || "list";
    const listSort = list.itemSort || "alphabetical";
    const listSortOrder = list.sortOrder || 0;

    const savedItems = await state.db.items
      .find({ selector: { listId: state.currentListId } })
      .exec();
    const savedItemsData = savedItems.map((d) => d.toJSON());

    await deleteList(state.currentListId);
    showUndoToast(`"${listName}" deleted`, async () => {
      try {
        const timestamp = now();
        const newListId = crypto.randomUUID();
        await state.db.lists.insert({
          id: newListId,
          name: listName,
          icon: listIcon,
          itemSort: listSort,
          sortOrder: listSortOrder,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        for (const item of savedItemsData) {
          await state.db.items.insert({
            id: crypto.randomUUID(),
            listId: newListId,
            text: item.text,
            completed: item.completed,
            createdAt: item.createdAt,
            updatedAt: timestamp,
            completedAt: item.completedAt || null,
          });
        }
        selectList(newListId);
      } catch (error) {
        reportError("restore list", error);
        showErrorToast("Failed to restore list");
      }
    });
  });

  // Add list modal
  dom.addListBtn.addEventListener("click", () => {
    dom.newListModal.classList.add("open");
    dom.newListName.value = "";
    state.selectedIcon = "list";
    updateIconPreview(dom.iconPreview, state.selectedIcon);
    dom.iconOptionsContainer.querySelectorAll(".icon-option").forEach((opt) => {
      opt.classList.toggle("selected", opt.dataset.icon === state.selectedIcon);
    });
    dom.iconPickerToggle.classList.remove("open");
    dom.iconOptionsContainer.classList.remove("expanded");
    setTimeout(() => dom.newListName.focus(), 100);
  });

  // Icon selection for new list
  dom.iconOptionsContainer.addEventListener("click", (e) => {
    const option = e.target.closest(".icon-option");
    if (!option) return;
    state.selectedIcon = option.dataset.icon;
    updateIconPreview(dom.iconPreview, state.selectedIcon);
    dom.iconOptionsContainer.querySelectorAll(".icon-option").forEach((opt) => {
      opt.classList.toggle("selected", opt.dataset.icon === state.selectedIcon);
    });
  });

  // Icon selection for edit list
  dom.editIconOptionsContainer.addEventListener("click", (e) => {
    const option = e.target.closest(".icon-option");
    if (!option) return;
    state.editSelectedIcon = option.dataset.icon;
    updateIconPreview(dom.editIconPreview, state.editSelectedIcon);
    dom.editIconOptionsContainer
      .querySelectorAll(".icon-option")
      .forEach((opt) => {
        opt.classList.toggle(
          "selected",
          opt.dataset.icon === state.editSelectedIcon,
        );
      });
  });

  // New list form
  dom.newListForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = dom.newListName.value.trim();
    if (name) {
      await createList(name, state.selectedIcon);
      dom.newListModal.classList.remove("open");
    }
  });

  dom.cancelNewList.addEventListener("click", () =>
    dom.newListModal.classList.remove("open"),
  );

  // Edit list form
  dom.editListForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = dom.editListName.value.trim();
    if (name && state.currentListId) {
      await updateList(
        state.currentListId,
        name,
        state.editSelectedIcon,
        dom.editListSort.value,
      );
      dom.editListModal.classList.remove("open");
    }
  });

  dom.cancelEditList.addEventListener("click", () =>
    dom.editListModal.classList.remove("open"),
  );

  // Edit item form
  dom.editItemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = dom.editItemText.value.trim();
    if (text && state.editingItemId) {
      await updateItem(state.editingItemId, { text });
      dom.editItemModal.classList.remove("open");
      state.editingItemId = null;
    }
  });

  dom.cancelEditItem.addEventListener("click", () => {
    dom.editItemModal.classList.remove("open");
    state.editingItemId = null;
  });

  // Delete item (with undo)
  dom.deleteEditItem.addEventListener("click", async () => {
    if (!state.editingItemId) return;
    const item = state.items.find((i) => i.id === state.editingItemId);
    const itemText = item ? item.text : "";
    const itemListId = item ? item.listId : state.currentListId;
    const itemId = state.editingItemId;
    dom.editItemModal.classList.remove("open");
    state.editingItemId = null;
    await deleteItem(itemId);
    showUndoToast(`"${itemText}" deleted`, async () => {
      await createItem(itemText, itemListId);
    });
  });

  // Modal backdrop dismiss
  dom.newListModal.addEventListener("click", (e) => {
    if (e.target === dom.newListModal)
      dom.newListModal.classList.remove("open");
  });
  dom.editListModal.addEventListener("click", (e) => {
    if (e.target === dom.editListModal)
      dom.editListModal.classList.remove("open");
  });
  dom.editItemModal.addEventListener("click", (e) => {
    if (e.target === dom.editItemModal) {
      dom.editItemModal.classList.remove("open");
      state.editingItemId = null;
    }
  });

  // Metrics modal
  dom.metricsBtn.addEventListener("click", () => {
    openMetrics();
    dom.closeMobileMenu();
  });

  dom.closeMetricsBtn.addEventListener("click", closeMetrics);

  dom.metricsModal.addEventListener("click", (e) => {
    if (e.target === dom.metricsModal) closeMetrics();
  });

  // Settings modal
  dom.settingsBtn.addEventListener("click", () => {
    dom.listSortSetting.value = state.appSettings.list_sort || "alphabetical";
    dom.settingsModal.classList.add("open");
    dom.closeMobileMenu();
  });

  dom.cancelSettings.addEventListener("click", () =>
    dom.settingsModal.classList.remove("open"),
  );

  dom.saveSettings.addEventListener("click", async () => {
    const newListSort = dom.listSortSetting.value;
    await updateSettings({ list_sort: newListSort });
    dom.settingsModal.classList.remove("open");
  });

  dom.clearCacheBtn.addEventListener("click", async () => {
    if (state.db) {
      await state.db.remove();
    }
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
    location.reload();
  });

  dom.settingsModal.addEventListener("click", (e) => {
    if (e.target === dom.settingsModal)
      dom.settingsModal.classList.remove("open");
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dom.newListModal.classList.remove("open");
      dom.editListModal.classList.remove("open");
      dom.editItemModal.classList.remove("open");
      dom.settingsModal.classList.remove("open");
      closeMetrics();
      state.editingItemId = null;
      dom.historyPanel.classList.remove("open");
      dom.overlay.classList.remove("visible");
      dom.closeMobileMenu();
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key === "n" &&
      document.activeElement !== dom.addItemInput &&
      document.activeElement !== dom.newListName &&
      document.activeElement !== dom.editListName &&
      document.activeElement !== dom.editItemText
    ) {
      e.preventDefault();
      dom.addItemInput.focus();
    }
  });

  // Restore sidebar state
  if (localStorage.getItem("sidebarCollapsed") === "true") {
    dom.sidebar.classList.add("collapsed");
  }

  // Touch swipe navigation
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  dom.mainContent.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    },
    { passive: true },
  );

  dom.mainContent.addEventListener(
    "touchend",
    (e) => {
      touchEndX = e.changedTouches[0].screenX;
      touchEndY = e.changedTouches[0].screenY;
      handleSwipe();
    },
    { passive: true },
  );

  function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const minSwipeDistance = 80;
    if (
      Math.abs(deltaX) < minSwipeDistance ||
      Math.abs(deltaX) < Math.abs(deltaY)
    )
      return;

    const currentIndex = state.lists.findIndex(
      (l) => l.id === state.currentListId,
    );
    if (currentIndex === -1) return;

    const swipeLeft = deltaX < 0;
    let targetListId;
    if (swipeLeft) {
      const nextIndex = currentIndex + 1;
      targetListId =
        nextIndex < state.lists.length
          ? state.lists[nextIndex].id
          : state.lists[0].id;
    } else {
      const prevIndex = currentIndex - 1;
      targetListId =
        prevIndex >= 0
          ? state.lists[prevIndex].id
          : state.lists[state.lists.length - 1].id;
    }

    const outClass = swipeLeft ? "swipe-out-left" : "swipe-out-right";
    const inClass = swipeLeft ? "swipe-in-left" : "swipe-in-right";
    dom.itemsList.classList.add(outClass);
    dom.listTitle.classList.add("fade-out");
    setTimeout(() => {
      dom.itemsList.classList.remove(outClass);
      dom.listTitle.classList.remove("fade-out");
      selectList(targetListId);
      dom.itemsList.classList.add(inClass);
      dom.listTitle.classList.add("fade-in");
      setTimeout(() => {
        dom.itemsList.classList.remove(inClass);
        dom.listTitle.classList.remove("fade-in");
      }, 150);
    }, 150);
  }

  // Visual viewport tracking for modal positioning
  if (window.visualViewport) {
    function updateVisualViewport() {
      const vv = window.visualViewport;
      document.documentElement.style.setProperty(
        "--visual-viewport-height",
        `${vv.height}px`,
      );
    }
    updateVisualViewport();
    window.visualViewport.addEventListener("resize", updateVisualViewport);
    window.visualViewport.addEventListener("scroll", updateVisualViewport);
  }
}
