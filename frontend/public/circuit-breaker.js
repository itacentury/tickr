/**
 * Reload-loop circuit breaker.
 *
 * Loaded as a classic, same-origin script in the document head (see
 * index.html) so it runs before the deferred app bundle and before any
 * service worker logic — it still triggers even if those are the cause of the
 * loop. Counts loads per tab in a short window; once a runaway reload loop is
 * detected it self-heals (unregisters service workers, clears caches and
 * IndexedDB) and HALTS on a recovery screen instead of reloading again.
 *
 * Served externally (not inline) because the app's strict Content-Security-
 * Policy (default-src 'self', no script-src) forbids inline scripts but allows
 * same-origin ones. The recovery screen is styled via the CSSOM
 * (element.style.*), which CSP does not block, rather than inline style
 * attributes.
 */
(function () {
  "use strict";

  var KEY = "tickr_reload_guard";
  var LIMIT = 4; // this many loads ...
  var WINDOW_MS = 10000; // ... within this window counts as a loop

  var now = Date.now();
  var hits;
  try {
    hits = JSON.parse(sessionStorage.getItem(KEY) || "[]");
  } catch {
    hits = [];
  }
  hits = hits.filter(function (t) {
    return now - t < WINDOW_MS;
  });
  hits.push(now);
  sessionStorage.setItem(KEY, JSON.stringify(hits));

  if (hits.length < LIMIT) return;

  sessionStorage.removeItem(KEY);
  // Tell the app bundle to skip service worker registration so it does not
  // immediately re-arm a controllerchange-driven reload.
  window.__tickrRecovery = true;

  var done = Promise.resolve();
  if ("serviceWorker" in navigator) {
    done = navigator.serviceWorker
      .getRegistrations()
      .then(function (rs) {
        return Promise.all(
          rs.map(function (r) {
            return r.unregister();
          }),
        );
      })
      .catch(function () {});
  }
  if ("caches" in window) {
    done = done
      .then(function () {
        return caches.keys();
      })
      .then(function (ns) {
        return Promise.all(
          ns.map(function (n) {
            return caches.delete(n);
          }),
        );
      })
      .catch(function () {});
  }
  if (window.indexedDB && indexedDB.deleteDatabase) {
    try {
      indexedDB.deleteDatabase("tickrdb");
    } catch {
      // Best-effort wipe; ignore if the database is locked or unavailable.
    }
  }

  done.then(showRecoveryScreen);

  /**
   * Replace the page with a minimal recovery screen. Styled via the CSSOM so it
   * works under the strict CSP and without the (possibly broken) bundle CSS.
   */
  function showRecoveryScreen() {
    var body = document.createElement("body");
    Object.assign(body.style, {
      fontFamily: "sans-serif",
      background: "#0d0d0f",
      color: "#eee",
      display: "flex",
      minHeight: "100vh",
      alignItems: "center",
      justifyContent: "center",
      margin: "0",
    });

    var box = document.createElement("div");
    Object.assign(box.style, {
      textAlign: "center",
      padding: "24px",
      maxWidth: "320px",
    });

    var title = document.createElement("h1");
    title.textContent = "App reset";
    title.style.fontSize = "18px";

    var text = document.createElement("p");
    text.textContent =
      "A reload loop was detected and stopped. Caches and local data have been cleared.";
    Object.assign(text.style, { opacity: "0.7", fontSize: "14px" });

    var button = document.createElement("button");
    button.textContent = "Reload";
    Object.assign(button.style, {
      marginTop: "12px",
      padding: "10px 18px",
      border: "0",
      borderRadius: "8px",
      background: "#3b82f6",
      color: "#fff",
      fontSize: "14px",
      cursor: "pointer",
    });
    button.addEventListener("click", function () {
      location.replace(location.pathname);
    });

    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(button);
    body.appendChild(box);

    // The breaker runs from <head>, so <body> may not be parsed yet. Swap it in
    // once it exists.
    if (document.body) {
      document.documentElement.replaceChild(body, document.body);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        document.documentElement.replaceChild(body, document.body);
      });
    }
  }
})();
