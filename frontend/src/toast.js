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
// Called when the undo window closes without an undo (timeout, dismiss, being
// replaced by a newer toast, or page unload). Used to finalize a deferred
// deletion. Cleared once run so it never fires twice.
let toastCommitCallback = null;
let toastRemainingTime = 5000;

/**
 * Run the pending commit callback exactly once, if any. Invoked whenever the
 * undo window resolves in favor of keeping the action (i.e. not undone).
 */
function commitPending() {
  const commit = toastCommitCallback;
  toastCommitCallback = null;
  if (commit) commit();
}

/**
 * Show an undo toast with the given message.
 *
 * @param {string} message - Text to display in the toast.
 * @param {Function|{onUndo?: Function, onCommit?: Function}} undoOrOptions -
 *   Either a bare undo callback (legacy form) or an options object.
 *   `onUndo` runs when the user clicks Undo; `onCommit` runs when the window
 *   closes without an undo (used to finalize a deferred deletion).
 */
export function showUndoToast(message, undoOrOptions) {
  const { onUndo = null, onCommit = null } =
    typeof undoOrOptions === "function"
      ? { onUndo: undoOrOptions }
      : (undoOrOptions ?? {});
  presentToast(message, onUndo, onCommit);
}

/** Display or update the toast with a new message and callbacks. */
function presentToast(message, undoCallback, commitCallback) {
  // A new toast replaces any pending one — finalize the outgoing deletion
  // first so it is never left unresolved.
  commitPending();
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toastUndoCallback = undoCallback;
  toastCommitCallback = commitCallback;
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
    toastTimeout = setTimeout(() => {
      commitPending();
      hideUndoToast();
    }, toastRemainingTime);
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

/**
 * Dismiss the toast and clear any pending timeout. Does not run the commit
 * callback — callers that mean "keep the action" call commitPending() first.
 */
export function hideUndoToast() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toastUndoCallback = null;
  toastCommitCallback = null;
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
  toastTimeout = setTimeout(() => {
    commitPending();
    hideUndoToast();
  }, 5000);
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

/** Pause the error-toast countdown (e.g. on hover). */
function pauseErrorToast() {
  if (errorToastTimeout) {
    clearTimeout(errorToastTimeout);
    errorToastTimeout = null;
  }
  errorToastProgress.style.opacity = "0";
}

/** Resume the error-toast countdown after a pause. */
function resumeErrorToast() {
  if (!errorToast.classList.contains("visible")) return;
  errorToastProgress.style.opacity = "1";
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

  errorToast.addEventListener("mouseenter", pauseErrorToast);
  errorToast.addEventListener("mouseleave", resumeErrorToast);

  toastUndo.addEventListener("click", async () => {
    // Undo cancels the deferred action — never commit it.
    toastCommitCallback = null;
    if (toastUndoCallback) await toastUndoCallback();
    hideUndoToast();
  });

  // Dismissing the toast accepts the action (e.g. finalizes the deletion).
  toastClose.addEventListener("click", () => {
    commitPending();
    hideUndoToast();
  });
  errorToastClose.addEventListener("click", () => hideErrorToast());

  // If the page is closed while an undo window is open, finalize the pending
  // deletion (best-effort; the RxDB write may not complete during unload, in
  // which case the document simply survives and reappears on next load).
  window.addEventListener("beforeunload", commitPending);
}
