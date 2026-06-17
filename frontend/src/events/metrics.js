/**
 * Metrics modal event wiring.
 *
 * Covers opening/closing the metrics modal, the time-range segmented control
 * and backdrop dismissal.
 */

import * as dom from "../dom.js";
import { openMetrics, closeMetrics, setMetricsWindow } from "../metrics.js";
import { makeBackdropDismiss } from "./modal-helpers.js";

/** Metrics modal: open/close, time-range control, backdrop dismiss. */
export function wireMetrics() {
  dom.metricsBtn.addEventListener("click", () => {
    openMetrics();
    dom.closeMobileMenu();
  });

  dom.closeMetricsBtn.addEventListener("click", closeMetrics);

  // Time-range segmented control: switch window and refresh.
  dom.metricsRange.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const btn = /** @type {HTMLElement} */ (
      target.closest("button[data-window]")
    );
    if (!btn) return;
    for (const b of dom.metricsRange.querySelectorAll("button")) {
      b.classList.toggle("active", b === btn);
    }
    setMetricsWindow(Number(btn.dataset.window));
  });

  makeBackdropDismiss(dom.metricsModal, closeMetrics);
}
