/**
 * Keyboard, touch and viewport event wiring.
 *
 * Covers global keyboard shortcuts (Escape/Ctrl+N), touch-swipe navigation
 * between lists on the main content area, and tracking the visual viewport
 * height for modal positioning.
 */

import { state } from "../state.js";
import * as dom from "../dom.js";
import { selectList } from "../data.js";
import { LIST_SWIPE_ANIMATION_MS } from "../timing.js";
import { closeAllModals } from "./modals.js";

/** Global keyboard shortcuts: Escape closes modals, Ctrl/Cmd+N focuses input. */
export function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllModals();
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
}

/** Touch-swipe navigation between lists on the main content area. */
export function wireSwipeNavigation() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  dom.mainContent.addEventListener(
    "touchstart",
    (e) => {
      const touch = /** @type {TouchEvent} */ (e);
      touchStartX = touch.changedTouches[0].screenX;
      touchStartY = touch.changedTouches[0].screenY;
    },
    { passive: true },
  );

  dom.mainContent.addEventListener(
    "touchend",
    (e) => {
      const touch = /** @type {TouchEvent} */ (e);
      touchEndX = touch.changedTouches[0].screenX;
      touchEndY = touch.changedTouches[0].screenY;
      handleSwipe();
    },
    { passive: true },
  );

  const handleSwipe = () => {
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
      }, LIST_SWIPE_ANIMATION_MS);
    }, LIST_SWIPE_ANIMATION_MS);
  };
}

/** Track the visual viewport height for modal positioning. */
export function wireVisualViewport() {
  if (!window.visualViewport) return;

  const updateVisualViewport = () => {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty(
      "--visual-viewport-height",
      `${vv.height}px`,
    );
  };
  updateVisualViewport();
  window.visualViewport.addEventListener("resize", updateVisualViewport);
  window.visualViewport.addEventListener("scroll", updateVisualViewport);
}
