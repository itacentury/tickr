/**
 * Settings modal event wiring.
 *
 * Covers opening/saving settings, clearing the cache, signing out and backdrop
 * dismissal.
 */

import { state } from "../state.js";
import * as dom from "../dom.js";
import { setDropdownValue } from "../dropdown.js";
import { flushPendingSettings, updateSettings } from "../data.js";
import { settingsRejected$, sseConnected$ } from "../bus.js";
import { logout } from "../auth.js";
import { reportError } from "../error-reporting.js";
import { showErrorToast } from "../toast.js";
import { makeBackdropDismiss } from "./modal-helpers.js";

/** Settings modal: open/save, clear cache, sign out, backdrop dismiss. */
export function wireSettings() {
  dom.settingsBtn.addEventListener("click", () => {
    setDropdownValue(
      dom.listSortSettingDropdown,
      state.appSettings.list_sort || "alphabetical",
    );
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
    try {
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
    } catch (error) {
      reportError("clear cache", error);
      showErrorToast("Failed to clear cache");
    }
  });

  // Sign out: clear the server session, then reload so the auth gate re-renders.
  dom.logoutBtn?.addEventListener("click", async () => {
    await logout();
    location.reload();
  });

  makeBackdropDismiss(dom.settingsModal);

  // Flushes every queued setting, not just this modal's: the edit-list default
  // (events/default-list.js) queues here too. The SSE reopen covers a missed
  // `online` event (iOS PWAs, flaky links).
  window.addEventListener("online", () => void flushPendingSettings());
  sseConnected$.subscribe(() => void flushPendingSettings());
}

/**
 * The single place a rejected settings patch is reported, whichever caller
 * (save, startup, resume, reconnect) started the flush. Wired apart from
 * wireSettings() because initApp() must call it before the startup flush,
 * which can reject before setupEventListeners() runs.
 */
export function wireSettingsRejectedToast() {
  settingsRejected$.subscribe(() =>
    showErrorToast("Failed to update settings"),
  );
}
