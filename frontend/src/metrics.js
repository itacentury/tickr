/**
 * Metrics dashboard module.
 *
 * Fetches, polls, and renders live application metrics inside a modal overlay.
 * Auto-refreshes every 10 seconds while the modal is open.
 */

import * as dom from "./dom.js";

let pollInterval = null;

/**
 * Escape HTML special characters to prevent XSS when inserting into innerHTML.
 *
 * @param {string} str - Raw string to escape.
 * @returns {string} HTML-safe string.
 */
function esc(str) {
  const el = document.createElement("span");
  el.textContent = String(str);
  return el.innerHTML;
}

/** Open the metrics modal and start polling. */
export function openMetrics() {
  dom.metricsModal.classList.add("open");
  refreshMetrics();
  pollInterval = setInterval(refreshMetrics, 10_000);
}

/** Close the metrics modal and stop polling. */
export function closeMetrics() {
  dom.metricsModal.classList.remove("open");
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/** Fetch metrics and health data, then render the dashboard. */
async function refreshMetrics() {
  try {
    const [metricsRes, healthRes] = await Promise.all([
      fetch("/api/v1/metrics"),
      fetch("/api/v1/health"),
    ]);

    if (!metricsRes.ok || !healthRes.ok) {
      renderError();
      return;
    }

    const metrics = await metricsRes.json();
    const health = await healthRes.json();
    renderMetrics(metrics, health);
  } catch {
    renderError();
  }
}

/**
 * Render the full metrics dashboard into the modal body.
 *
 * @param {object} metrics - Snapshot from /api/v1/metrics.
 * @param {object} health - Health check from /api/v1/health.
 */
function renderMetrics(metrics, health) {
  const isHealthy = health.status === "healthy";
  const uptime = esc(formatUptime(metrics.uptime_seconds));
  const total = Number(metrics.requests.total).toLocaleString();
  const rt = metrics.response_times;
  const conn = metrics.connections;
  const sseTotal = conn.sse_legacy + conn.sse_sync;
  const ssePct = conn.sse_max > 0 ? (sseTotal / conn.sse_max) * 100 : 0;

  const methodBars = buildBarRows(metrics.requests.by_method, "fill-accent");
  const statusBars = buildStatusBars(metrics.requests.by_status);
  const pathBars = buildBarRows(metrics.requests.by_path, "fill-accent");

  dom.metricsBody.innerHTML = `
    <div class="metrics-grid">
      <div class="stat-card">
        <div class="stat-label">Health</div>
        <div class="stat-value">
          <span class="health-dot ${isHealthy ? "healthy" : "unhealthy"}"></span>
          ${isHealthy ? "Healthy" : "Unhealthy"}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Uptime</div>
        <div class="stat-value">${uptime}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Requests</div>
        <div class="stat-value">${esc(total)}</div>
      </div>
    </div>
    <div class="metrics-grid">
      <div class="stat-card">
        <div class="stat-label">p50 (ms)</div>
        <div class="stat-value">${esc(rt.p50_ms)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">p95 (ms)</div>
        <div class="stat-value">${esc(rt.p95_ms)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">p99 (ms)</div>
        <div class="stat-value">${esc(rt.p99_ms)}</div>
      </div>
    </div>
    <div class="gauge-section">
      <div class="gauge-header">
        <span class="gauge-title">SSE Connections</span>
        <span class="gauge-value">${esc(sseTotal)} / ${esc(conn.sse_max)}</span>
      </div>
      <div class="gauge-track">
        <div class="gauge-fill" style="width: ${Math.min(ssePct, 100)}%"></div>
      </div>
    </div>
    ${methodBars.length ? `<div class="bar-chart"><div class="bar-chart-title">Requests by Method</div>${methodBars}</div>` : ""}
    ${statusBars.length ? `<div class="bar-chart"><div class="bar-chart-title">Requests by Status</div>${statusBars}</div>` : ""}
    ${pathBars.length ? `<div class="bar-chart"><div class="bar-chart-title">Requests by Path</div>${pathBars}</div>` : ""}
  `;
}

/** Show an error state with a retry button. */
function renderError() {
  dom.metricsBody.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "metrics-error";

  const msg = document.createElement("p");
  msg.textContent = "Could not load metrics";
  wrapper.appendChild(msg);

  const btn = document.createElement("button");
  btn.className = "metrics-error-btn";
  btn.textContent = "Retry";
  btn.addEventListener("click", refreshMetrics);
  wrapper.appendChild(btn);

  dom.metricsBody.appendChild(wrapper);
}

/**
 * Build horizontal bar chart rows from a key-value map.
 *
 * @param {object} data - Map of label → count.
 * @param {string} fillClass - CSS class for bar fill color.
 * @returns {string} HTML string of bar rows.
 */
function buildBarRows(data, fillClass) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";

  const max = entries[0][1];
  return entries
    .map(([label, count]) => {
      const pct = max > 0 ? (count / max) * 100 : 0;
      return `
        <div class="bar-row">
          <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
          <div class="bar-track"><div class="bar-fill ${fillClass}" style="width: ${pct}%"></div></div>
          <span class="bar-value">${Number(count).toLocaleString()}</span>
        </div>`;
    })
    .join("");
}

/**
 * Build status code bar rows with color coding by status class.
 *
 * 2xx → success (green), 4xx → warning (amber), 5xx → danger (red).
 *
 * @param {object} data - Map of status code → count.
 * @returns {string} HTML string of bar rows.
 */
function buildStatusBars(data) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";

  const max = entries[0][1];
  return entries
    .map(([code, count]) => {
      const pct = max > 0 ? (count / max) * 100 : 0;
      let fillClass = "fill-accent";
      if (code.startsWith("2")) fillClass = "fill-success";
      else if (code.startsWith("4")) fillClass = "fill-warning";
      else if (code.startsWith("5")) fillClass = "fill-danger";
      return `
        <div class="bar-row">
          <span class="bar-label">${esc(code)}</span>
          <div class="bar-track"><div class="bar-fill ${fillClass}" style="width: ${pct}%"></div></div>
          <span class="bar-value">${Number(count).toLocaleString()}</span>
        </div>`;
    })
    .join("");
}

/**
 * Format seconds into a human-readable uptime string.
 *
 * @param {number} seconds - Total uptime in seconds.
 * @returns {string} Formatted string like "3d 10h 17m".
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
