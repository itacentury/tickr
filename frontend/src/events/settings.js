/**
 * Settings modal event wiring.
 *
 * Covers opening/saving settings, clearing the cache, signing out and backdrop
 * dismissal.
 */

import { state } from "../state.js";
import * as dom from "../dom.js";
import { setDropdownValue } from "../dropdown.js";
import { updateSettings } from "../data.js";
import { logout } from "../auth.js";
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

  // Sign out: clear the server session, then reload so the auth gate re-renders.
  dom.logoutBtn?.addEventListener("click", async () => {
    await logout();
    location.reload();
  });

  makeBackdropDismiss(dom.settingsModal);
}
