/**
 * Toast notification system for undo actions and error feedback.
 *
 * Provides an undo toast with countdown and an error toast for DB failures.
 * Imports only from dom.js (leaf-like dependency).
 */

import {
  undoToast,
  toastMessage,
  toastUndo,
  toastClose,
  toastProgress,
  errorToast,
  errorToastMessage,
  errorToastClose,
  errorToastProgress,
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

// Error toast state
let errorToastTimeout = null;

/**
 * Show an error toast with the given message.
 * Auto-dismisses after 4 seconds.
 *
 * @param {string} message - Text to display in the error toast.
 */
export function showErrorToast(message) {
  if (errorToastTimeout) {
    clearTimeout(errorToastTimeout);
    errorToastTimeout = null;
  }

  errorToastMessage.textContent = message;
  errorToast.classList.add("visible");

  errorToastProgress.style.transition = "none";
  errorToastProgress.style.transform = "scaleX(1)";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      errorToastProgress.style.transition = "transform 4000ms linear";
      errorToastProgress.style.transform = "scaleX(0)";
    });
  });

  errorToastTimeout = setTimeout(() => hideErrorToast(), 4000);
}

/** Dismiss the error toast and clear any pending timeout. */
export function hideErrorToast() {
  if (errorToastTimeout) {
    clearTimeout(errorToastTimeout);
    errorToastTimeout = null;
  }
  errorToast.classList.remove("visible");
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
  errorToastClose.addEventListener("click", () => hideErrorToast());
}
