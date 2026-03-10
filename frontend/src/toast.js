/**
 * Undo toast notification system.
 *
 * Provides a toast with an undo button and auto-dismiss countdown.
 * Imports only from dom.js (leaf-like dependency).
 */

import {
  undoToast,
  toastMessage,
  toastUndo,
  toastClose,
  toastProgress,
} from "./dom.js";

// Module-private toast state
let toastTimeout = null;
let toastUndoCallback = null;
let toastRemainingTime = 5000;

/**
 * Show an undo toast with the given message.
 *
 * @param {string} message - Text to display in the toast.
 * @param {Function} undoCallback - Called when the user clicks Undo.
 */
export function showUndoToast(message, undoCallback) {
  presentToast(message, undoCallback);
}

/** Display or update the toast with a new message and callback. */
function presentToast(message, undoCallback) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toastUndoCallback = undoCallback;
  toastRemainingTime = 5000;
  const isVisible = undoToast.classList.contains("visible");

  function startCountdown() {
    toastProgress.style.opacity = "1";
    toastProgress.style.transition = "none";
    toastProgress.style.transform = "scaleX(1)";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toastProgress.style.transition = `transform ${toastRemainingTime}ms linear`;
        toastProgress.style.transform = "scaleX(0)";
      });
    });
    toastTimeout = setTimeout(() => hideUndoToast(), toastRemainingTime);
  }

  if (isVisible) {
    toastMessage.classList.add("swapping");
    setTimeout(() => {
      toastMessage.textContent = message;
      toastMessage.classList.remove("swapping");
      startCountdown();
    }, 150);
  } else {
    toastMessage.textContent = message;
    undoToast.classList.add("visible");
    startCountdown();
  }
}

/** Dismiss the toast and clear any pending timeout. */
export function hideUndoToast() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toastUndoCallback = null;
  undoToast.classList.remove("visible");
}

/** Pause the toast countdown (e.g. on hover). */
function pauseToast() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toastProgress.style.opacity = "0";
}

/** Resume the toast countdown after a pause. */
function resumeToast() {
  if (!undoToast.classList.contains("visible")) return;
  toastRemainingTime = 5000;
  toastProgress.style.opacity = "1";
  toastProgress.style.transition = "none";
  toastProgress.style.transform = "scaleX(1)";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toastProgress.style.transition = "transform 5s linear";
      toastProgress.style.transform = "scaleX(0)";
    });
  });
  toastTimeout = setTimeout(() => hideUndoToast(), 5000);
}

/**
 * Attach toast interaction listeners (hover pause, undo/close buttons).
 * Must be called once during setup rather than at module load.
 */
export function initToastListeners() {
  undoToast.addEventListener("mouseenter", pauseToast);
  undoToast.addEventListener("mouseleave", resumeToast);

  toastUndo.addEventListener("click", async () => {
    if (toastUndoCallback) await toastUndoCallback();
    hideUndoToast();
  });

  toastClose.addEventListener("click", () => hideUndoToast());
}
