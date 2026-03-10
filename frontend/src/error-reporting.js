/**
 * Frontend error reporting utility.
 *
 * Sends error reports to the server via fire-and-forget POST requests.
 * Network failures are silently swallowed to avoid cascading errors
 * in an offline-first application.
 */

/**
 * Report an error to the server and log it locally.
 *
 * @param {string} action - Short description of what failed (e.g. "create list").
 * @param {Error|unknown} error - The error object or rejection reason.
 */
export function reportError(action, error) {
  try {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    const stack = error instanceof Error ? error.stack : undefined;

    console.error(`Failed to ${action}:`, error);

    fetch("/api/v1/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        stack,
        action,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch {
    // Guard against synchronous throw — never break the caller
  }
}

// ---- Global error handlers ----

window.addEventListener("error", (event) => {
  reportError("unhandled error", event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  reportError("unhandled rejection", event.reason);
});
