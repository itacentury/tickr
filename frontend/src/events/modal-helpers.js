/**
 * Shared modal event-wiring helpers.
 *
 * Small utilities reused across the per-feature wire*() modules in ./events/,
 * kept here so feature files don't depend on each other for them.
 */

/**
 * Wire backdrop-click dismissal for a modal. onClose (if provided) runs
 * after removing `open`, so transient state (e.g. editingItemId) can reset.
 *
 * @param {HTMLElement} modal
 * @param {() => void} [onClose]
 */
export function makeBackdropDismiss(modal, onClose) {
  modal.addEventListener("click", (e) => {
    if (e.target !== modal) return;
    modal.classList.remove("open");
    onClose?.();
  });
}
