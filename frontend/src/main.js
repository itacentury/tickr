/**
 * Application entry point.
 *
 * Imports styles and initializes the offline-first todo app with RxDB.
 */

import "./error-reporting.js";
import "./styles/variables.css";
import "./styles/reset.css";
import "./styles/layout.css";
import "./styles/sidebar.css";
import "./styles/header.css";
import "./styles/form.css";
import "./styles/items.css";
import "./styles/empty-state.css";
import "./styles/history.css";
import "./styles/modal.css";
import "./styles/toast.css";
import "./styles/metrics.css";
import "./styles/animations.css";
import "./styles/utilities.css";
import "./styles/responsive.css";
import { reportError } from "./error-reporting.js";
import { initApp } from "./app.js";

initApp().catch((err) => {
  reportError("initialize app", err);
});

// Register Service Worker
if ("serviceWorker" in navigator) {
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("Service Worker registered");
        setInterval(() => reg.update(), 60000);

        if (reg.waiting) {
          showUpdateNotification(reg.waiting);
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              showUpdateNotification(newWorker);
            }
          });
        });
      })
      .catch((err) => console.log("Service Worker registration failed:", err));
  });

  /**
   * Show update notification when a new service worker is available.
   *
   * @param {ServiceWorker} worker - The waiting service worker.
   */
  function showUpdateNotification(worker) {
    const notification = document.createElement("div");
    notification.className = "sw-update-notification";

    const message = document.createElement("span");
    message.textContent = "New version available!";

    const updateBtn = document.createElement("button");
    updateBtn.textContent = "Update";
    updateBtn.className = "sw-update-btn";
    updateBtn.addEventListener("click", () => {
      worker.postMessage({ type: "SKIP_WAITING" });
      notification.remove();
    });

    const dismissBtn = document.createElement("button");
    dismissBtn.textContent = "Later";
    dismissBtn.className = "sw-dismiss-btn";
    dismissBtn.addEventListener("click", () => {
      notification.remove();
    });

    notification.appendChild(message);
    notification.appendChild(updateBtn);
    notification.appendChild(dismissBtn);
    document.body.appendChild(notification);
  }
}
