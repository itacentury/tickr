// @ts-nocheck — DOM-heavy view module: checkJs cannot narrow event.target /
// querySelector results without per-callsite casts.
/**
 * Metrics dashboard orchestration and HTML sections.
 *
 * Fetches, polls, and renders a live observability dashboard inside a modal overlay.
 * Auto-refreshes every 10 seconds while the modal is open and supports 1h/24h/7d windows.
 *
 * CSP note: the page runs under `default-src 'self'`, so no inline styles or scripts are
 * allowed. Charts are built as SVG (see ./charts.js) and bar widths are applied via CSSOM
 * (`el.style.width`), which CSP does not govern.
 */

import * as dom from "../dom.js";
import { escapeHtml as esc, cssVar } from "../dom.js";
import { METRICS_POLL_INTERVAL_MS } from "../timing.js";
import {
  buildSpark,
  buildTraffic,
  buildHistogram,
  buildDonut,
} from "./charts.js";
import {
  statusBuckets,
  formatUptime,
  formatDuration,
  formatAgo,
} from "./formatters.js";

let pollInterval = null;
let currentWindow = 86_400;

/** Human label per supported window. */
const WINDOW_LABELS = { 3600: "1h", 86400: "24h", 604800: "7d" };

/** X-axis tick labels per window for the traffic chart. */
const AXIS_LABELS = {
  3600: ["−60m", "−45m", "−30m", "−15m", "now"],
  86400: ["−24h", "−18h", "−12h", "−6h", "now"],
  604800: ["−7d", "−5d", "−3d", "−1d", "now"],
};

/** Open the metrics modal and start polling. */
export function openMetrics() {
  dom.metricsModal.classList.add("open");
  refreshMetrics();
  pollInterval = setInterval(refreshMetrics, METRICS_POLL_INTERVAL_MS);
}

/** Close the metrics modal and stop polling. */
export function closeMetrics() {
  dom.metricsModal.classList.remove("open");
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Switch the active time window and refresh immediately.
 *
 * @param {number} windowSeconds - One of 3600 / 86400 / 604800.
 */
export function setMetricsWindow(windowSeconds) {
  currentWindow = windowSeconds;
  refreshMetrics();
}

/** Fetch metrics and health data, then render the dashboard. */
async function refreshMetrics() {
  try {
    const [metricsRes, healthRes] = await Promise.all([
      fetch(`/api/v1/metrics?window=${currentWindow}`),
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
 * @param {object} m - Snapshot from /api/v1/metrics.
 * @param {object} health - Health check from /api/v1/health.
 */
function renderMetrics(m, health) {
  const isHealthy = health.status === "healthy";

  dom.metricsBody.innerHTML = `
    ${healthBanner(m, health, isHealthy)}
    ${overviewSection(m)}
    ${trafficSection(m)}
    ${latencySection(m)}
    ${endpointsSection(m)}
    ${resourcesSection(m)}
  `;

  postRender(m);
}

/** Health banner: status, uptime, last error, version/region. */
function healthBanner(m, health, isHealthy) {
  const lastError = m.last_error
    ? `${esc(m.last_error.status)} <small>· ${esc(m.last_error.path)}</small>`
    : `None <small>· 0 in ${esc(WINDOW_LABELS[m.window_seconds])}</small>`;
  const region = m.region ? ` <small>· ${esc(m.region)}</small>` : "";

  return `
    <div class="metrics-card metrics-health">
      <div class="seg">
        <span class="k">Health</span>
        <span class="v ${isHealthy ? "green" : "red"}">
          <span class="health-dot ${isHealthy ? "healthy" : "unhealthy"}"></span>
          ${isHealthy ? "Healthy" : "Unhealthy"}
        </span>
      </div>
      <div class="seg">
        <span class="k">Uptime</span>
        <span class="v mono">${esc(formatUptime(m.uptime_seconds))} <small>· since start</small></span>
      </div>
      <div class="seg">
        <span class="k">Last error</span>
        <span class="v">${lastError}</span>
      </div>
      <div class="seg">
        <span class="k">Version</span>
        <span class="v mono">v${esc(m.version || "?")}${region}</span>
      </div>
    </div>
  `;
}

/** KPI overview: total requests, throughput, error rate, avg response. */
function overviewSection(m) {
  const k = m.kpis;
  return `
    <div class="metrics-section">
      <p class="metrics-eyebrow">Overview</p>
      <div class="kpi-grid">
        ${kpiCard("Total Requests", k.total.value.toLocaleString(), "", k.total, "blue")}
        ${kpiCard("Throughput", k.throughput.value, "req/s", k.throughput, "blue")}
        ${kpiCard("Error Rate", k.error_rate.value, "%", k.error_rate, "green")}
        ${kpiCard("Avg Response", k.avg_response_ms.value, "ms", k.avg_response_ms, "blue")}
      </div>
    </div>
  `;
}

/** Build one KPI card with value, delta, and sparkline placeholder. */
function kpiCard(label, value, unit, kpi, sparkColor) {
  const unitHtml = unit ? `<span class="unit">${esc(unit)}</span>` : "";
  return `
    <div class="metrics-card kpi">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-val mono">${esc(value)}${unitHtml}</div>
      <div class="kpi-foot">
        ${deltaHtml(kpi)}
        <svg class="spark" data-spark="${esc((kpi.spark || []).join(","))}" data-color="${sparkColor}"></svg>
      </div>
    </div>
  `;
}

/** Render the trend delta chip for a KPI. */
function deltaHtml(kpi) {
  if (kpi.direction === "up") {
    return `<span class="delta up">▲ ${esc(kpi.pct)}%</span>`;
  }
  if (kpi.direction === "down") {
    return `<span class="delta down">▼ ${esc(Math.abs(kpi.pct))}%</span>`;
  }
  return `<span class="delta flat">— stable</span>`;
}

/** Traffic-over-time area chart. */
function trafficSection(m) {
  const peak = m.traffic.peak_value;
  const labels = AXIS_LABELS[m.window_seconds] || AXIS_LABELS[86400];
  return `
    <div class="metrics-section">
      <p class="metrics-eyebrow">Traffic Over Time</p>
      <div class="metrics-card chart-wrap">
        <div class="chart-meta">Peak <b>${esc(peak)}</b></div>
        <svg data-el="metricsTraffic" width="100%" height="120" preserveAspectRatio="none"></svg>
        <div class="chart-axis mono">
          ${labels.map((l) => `<span>${esc(l)}</span>`).join("")}
        </div>
      </div>
    </div>
  `;
}

/** Latency percentiles + histogram, request methods, and status donut. */
function latencySection(m) {
  const rt = m.response_times;
  const p99Warn = rt.p99_ms >= 100 ? "warn" : "";
  const p95Warn = rt.p95_ms >= 50 ? "warn" : "";

  return `
    <div class="metrics-section">
      <p class="metrics-eyebrow">Latency &amp; Distribution</p>
      <div class="metrics-cols-3">
        <div class="metrics-card">
          <div class="metrics-card-h">Response Time Percentiles</div>
          <div class="metrics-card-sub">${esc(rt.sample_count)} samples</div>
          <div class="perc-row">
            <div class="perc"><div class="p">p50</div><div class="n mono">${esc(rt.p50_ms)}<span class="u">ms</span></div></div>
            <div class="perc ${p95Warn}"><div class="p">p95</div><div class="n mono">${esc(rt.p95_ms)}<span class="u">ms</span></div></div>
            <div class="perc ${p99Warn}"><div class="p">p99</div><div class="n mono">${esc(rt.p99_ms)}<span class="u">ms</span></div></div>
          </div>
          <svg data-el="metricsHistogram" width="100%" height="56" preserveAspectRatio="none"></svg>
        </div>
        ${methodsCard(m)}
        ${statusCard(m)}
      </div>
    </div>
  `;
}

/** Requests-by-method bar card. */
function methodsCard(m) {
  const entries = Object.entries(m.requests.by_method).sort(
    (a, b) => b[1] - a[1],
  );
  const max = entries.length ? entries[0][1] : 0;
  const rows = entries
    .map(([method, count]) => {
      const pct = max > 0 ? (count / max) * 100 : 0;
      return `
        <div class="mbar">
          <span class="mtag">${esc(method)}</span>
          <div class="mtrack"><div class="mfill" data-pct="${pct}" data-method="${esc(method)}"></div></div>
          <span class="mval mono">${count.toLocaleString()}</span>
        </div>`;
    })
    .join("");
  return `
    <div class="metrics-card">
      <div class="metrics-card-h">By Method</div>
      <div class="metrics-card-sub">${esc(m.requests.total.toLocaleString())} requests</div>
      ${rows || '<div class="metrics-card-sub">No data</div>'}
    </div>
  `;
}

/** Requests-by-status donut card. */
function statusCard(m) {
  const buckets = statusBuckets(m.requests.by_status);
  const total = buckets.s2 + buckets.s4 + buckets.s5;
  const successPct = total > 0 ? Math.round((buckets.s2 / total) * 100) : 100;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return `
    <div class="metrics-card">
      <div class="metrics-card-h">By Status</div>
      <div class="metrics-card-sub">Success rate ${successPct}%</div>
      <div class="donut-row">
        <svg data-el="metricsDonut" width="86" height="86" viewBox="0 0 86 86" data-success="${successPct}"></svg>
        <div class="donut-legend">
          <div class="legend-item"><span class="sw" data-fill="success"></span><span class="lbl">2xx</span><span class="v mono">${buckets.s2}</span><span class="pct mono">${pct(buckets.s2)}%</span></div>
          <div class="legend-item"><span class="sw" data-fill="warning"></span><span class="lbl">4xx</span><span class="v mono">${buckets.s4}</span><span class="pct mono">${pct(buckets.s4)}%</span></div>
          <div class="legend-item"><span class="sw" data-fill="danger"></span><span class="lbl">5xx</span><span class="v mono">${buckets.s5}</span><span class="pct mono">${pct(buckets.s5)}%</span></div>
        </div>
      </div>
    </div>
  `;
}

/** Top-endpoints table. */
function endpointsSection(m) {
  const max = m.endpoints.length
    ? Math.max(...m.endpoints.map((e) => e.count))
    : 0;
  const rows = m.endpoints
    .map((e) => {
      const pct = max > 0 ? (e.count / max) * 100 : 0;
      const verbClass =
        e.method === "GET" ? "get" : e.method === "POST" ? "post" : "other";
      const latClass = e.p95_ms >= 50 ? "lat warn" : "lat";
      const errClass = e.errors > 0 ? "err-n" : "err-0";
      return `
        <tr>
          <td><div class="ep"><span class="verb ${verbClass}">${esc(e.method)}</span><span class="ep-path">${esc(e.path)}</span></div></td>
          <td class="right"><span class="count-cell"><span class="count-bar"><i data-pct="${pct}"></i></span><span class="mono">${e.count.toLocaleString()}</span></span></td>
          <td class="right"><span class="${latClass}">${esc(e.p95_ms)}ms</span></td>
          <td class="right ${errClass} mono">${esc(e.errors)}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="metrics-section">
      <p class="metrics-eyebrow">Top Endpoints</p>
      <div class="metrics-card">
        <table class="metrics-tbl">
          <thead><tr><th>Endpoint</th><th>Requests</th><th>p95</th><th>Errors</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="metrics-card-sub">No data in window</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

/** SSE / sync / system resource cards. */
function resourcesSection(m) {
  const c = m.connections;
  const sseTotal = c.sse_legacy + c.sse_sync;
  const ssePct =
    c.sse_max > 0 ? Math.min((sseTotal / c.sse_max) * 100, 100) : 0;

  const sync = m.sync;
  const syncTotal = sync.items_pulled + sync.items_pushed;
  const pushPct = syncTotal > 0 ? (sync.items_pushed / syncTotal) * 100 : 0;

  const sys = m.system;
  const cpuPct = sys.cpu_pct ?? 0;

  return `
    <div class="metrics-section">
      <p class="metrics-eyebrow">Connections &amp; Resources</p>
      <div class="metrics-cols-3b">
        <div class="metrics-card">
          <div class="metrics-card-h">SSE Connections</div>
          <div class="gauge-num"><span class="big mono">${esc(sseTotal)}</span><span class="max mono">/ ${esc(c.sse_max)}</span></div>
          <div class="gauge-track"><div class="gauge-fill" data-pct="${ssePct}"></div></div>
          <div class="mini-rows">
            <div class="mini-row"><span class="k">Events sent</span><span class="v mono">${(c.events_sent || 0).toLocaleString()}</span></div>
            <div class="mini-row"><span class="k">Avg connection duration</span><span class="v mono">${esc(formatDuration(c.avg_duration_seconds))}</span></div>
            <div class="mini-row"><span class="k">Total connections</span><span class="v mono">${esc(c.opened_total || 0)}</span></div>
          </div>
        </div>
        <div class="metrics-card">
          <div class="metrics-card-h">Sync Activity</div>
          <div class="gauge-num"><span class="big mono">${syncTotal.toLocaleString()}</span><span class="max">items synced</span></div>
          <div class="gauge-track"><div class="gauge-fill" data-pct="${pushPct}"></div></div>
          <div class="mini-rows">
            <div class="mini-row"><span class="k">Pulled / Pushed</span><span class="v mono">${sync.items_pulled.toLocaleString()} / ${sync.items_pushed.toLocaleString()}</span></div>
            <div class="mini-row"><span class="k">Conflicts resolved</span><span class="v mono">${esc(sync.conflicts_resolved)}</span></div>
            <div class="mini-row"><span class="k">Last sync</span><span class="v">${esc(formatAgo(sync.last_sync_ago_seconds))}</span></div>
          </div>
        </div>
        <div class="metrics-card">
          <div class="metrics-card-h">System</div>
          <div class="gauge-num"><span class="big mono">${esc(sys.memory_mb ?? "—")}</span><span class="max">MB · RSS</span></div>
          <div class="gauge-track"><div class="gauge-fill green-blue" data-pct="${cpuPct}"></div></div>
          <div class="mini-rows">
            <div class="mini-row"><span class="k">CPU</span><span class="v mono">${esc(sys.cpu_pct ?? "—")}%</span></div>
            <div class="mini-row"><span class="k">Event-Loop-Lag</span><span class="v mono">${esc(sys.event_loop_lag_ms ?? "—")}ms</span></div>
            <div class="mini-row"><span class="k">DB size</span><span class="v mono">${esc(sys.db_size_mb ?? "—")} MB</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Apply CSP-safe widths/colors and build every SVG chart after innerHTML insertion.
 *
 * @param {object} m - The metrics snapshot used to render the charts.
 */
function postRender(m) {
  const body = dom.metricsBody;

  // CSP-safe bar/gauge widths via CSSOM.
  for (const el of body.querySelectorAll("[data-pct]")) {
    el.style.width = `${el.dataset.pct}%`;
  }

  // Method bar colors.
  for (const el of body.querySelectorAll(".mfill[data-method]")) {
    el.style.background = methodColor(el.dataset.method);
  }

  // Legend swatch colors.
  const fillMap = {
    success: cssVar("--success"),
    warning: cssVar("--warning"),
    danger: cssVar("--danger"),
  };
  for (const el of body.querySelectorAll(".sw[data-fill]")) {
    el.style.background = fillMap[el.dataset.fill];
  }

  for (const el of body.querySelectorAll(".spark[data-spark]")) {
    buildSpark(el);
  }

  buildTraffic(body.querySelector('[data-el="metricsTraffic"]'), m.traffic);
  buildHistogram(
    body.querySelector('[data-el="metricsHistogram"]'),
    m.latency_histogram,
  );
  buildDonut(
    body.querySelector('[data-el="metricsDonut"]'),
    m.requests.by_status,
  );
}

/** Map an HTTP method to its bar color. */
function methodColor(method) {
  if (method === "GET") return cssVar("--accent");
  if (method === "POST") return cssVar("--success");
  if (method === "DELETE") return cssVar("--danger");
  return cssVar("--warning");
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
