/**
 * Live observability metrics dashboard.
 *
 * Barrel re-exporting the focused modules under ./metrics/. Importers keep using
 * "./metrics.js" so the split stays internal. Public surface (openMetrics,
 * closeMetrics, setMetricsWindow) lives in ./metrics/dashboard.js; charts.js and
 * formatters.js are module-internal.
 */

export * from "./metrics/dashboard.js";
