/**
 * Metrics dashboard module.
 *
 * Fetches, polls, and renders a live observability dashboard inside a modal overlay.
 * Auto-refreshes every 10 seconds while the modal is open and supports 1h/24h/7d windows.
 *
 * CSP note: the page runs under `default-src 'self'`, so no inline styles or scripts are
 * allowed. Charts are built here as SVG using presentation attributes (fill, d, …), and bar
 * widths are applied via CSSOM (`el.style.width`), which CSP does not govern.
 */

import * as dom from "./dom.js";

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

/**
 * Escape HTML special characters to prevent XSS when inserting into innerHTML.
 *
 * @param {*} str - Raw value to escape.
 * @returns {string} HTML-safe string.
 */
function esc(str) {
  const el = document.createElement("span");
  el.textContent = String(str);
  return el.innerHTML;
}

/** Read a CSS custom property from :root, resolved to its computed value. */
function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
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
        <svg id="metricsTraffic" width="100%" height="120" preserveAspectRatio="none"></svg>
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
          <svg id="metricsHistogram" width="100%" height="56" preserveAspectRatio="none"></svg>
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
        <svg id="metricsDonut" width="86" height="86" viewBox="0 0 86 86" data-success="${successPct}"></svg>
        <div class="donut-legend">
          <div class="legend-item"><span class="sw" data-fill="success"></span><span class="lbl">2xx</span><span class="v mono">${buckets.s2}</span><span class="pct mono">${pct(buckets.s2)}%</span></div>
          <div class="legend-item"><span class="sw" data-fill="warning"></span><span class="lbl">4xx</span><span class="v mono">${buckets.s4}</span><span class="pct mono">${pct(buckets.s4)}%</span></div>
          <div class="legend-item"><span class="sw" data-fill="danger"></span><span class="lbl">5xx</span><span class="v mono">${buckets.s5}</span><span class="pct mono">${pct(buckets.s5)}%</span></div>
        </div>
      </div>
    </div>
  `;
}

/** Collapse a status-code map into 2xx / 4xx / 5xx totals. */
function statusBuckets(byStatus) {
  const buckets = { s2: 0, s4: 0, s5: 0 };
  for (const [code, count] of Object.entries(byStatus)) {
    if (code.startsWith("2")) buckets.s2 += count;
    else if (code.startsWith("4")) buckets.s4 += count;
    else if (code.startsWith("5")) buckets.s5 += count;
  }
  return buckets;
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

  buildTraffic(body.querySelector("#metricsTraffic"), m.traffic);
  buildHistogram(body.querySelector("#metricsHistogram"), m.latency_histogram);
  buildDonut(body.querySelector("#metricsDonut"), m.requests.by_status);
}

/** Map an HTTP method to its bar color. */
function methodColor(method) {
  if (method === "GET") return cssVar("--accent");
  if (method === "POST") return cssVar("--success");
  if (method === "DELETE") return cssVar("--danger");
  return cssVar("--warning");
}

/** Build a small sparkline into the given SVG element. */
function buildSpark(svg) {
  const data = svg.dataset.spark
    .split(",")
    .filter((s) => s !== "")
    .map(Number);
  if (data.length < 2) {
    svg.innerHTML = "";
    return;
  }
  const color =
    svg.dataset.color === "green" ? cssVar("--success") : cssVar("--accent");
  const w = 74;
  const h = 26;
  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const flat = max - min === 0;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return [x, y];
  });
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w - pad} ${h - pad} L${pad} ${h - pad} Z`;
  const id = `sg${Math.random().toString(36).slice(2, 7)}`;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = `
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${flat ? "" : `<path d="${area}" fill="url(#${id})"/>`}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="${flat ? 0.5 : 1}"/>`;
}

/** Build the traffic area chart with y-axis gridlines. */
function buildTraffic(svg, traffic) {
  if (!svg) return;
  const data = traffic.points || [];
  const rect = svg.getBoundingClientRect();
  const W = rect.width || 1000;
  const H = 120;
  const gutter = 34;
  const top = 8;
  const bottom = 6;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const rawMax = data.length ? Math.max(...data) : 0;
  const niceMax = Math.max(5, Math.ceil(rawMax / 5) * 5);
  const plotW = W - gutter;
  const plotH = H - top - bottom;
  const yOf = (v) => top + plotH - (v / niceMax) * plotH;
  const pts = data.map((v, i) => [
    gutter + (i / Math.max(1, data.length - 1)) * plotW,
    yOf(v),
  ]);
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${line} L${(gutter + plotW).toFixed(1)} ${top + plotH} L${gutter} ${top + plotH} Z`;

  const accent = cssVar("--accent");
  const grid = cssVar("--border");
  const faint = cssVar("--text-muted");
  let axis = "";
  for (const t of [0, niceMax / 2, niceMax]) {
    const y = yOf(t);
    axis += `<line x1="${gutter}" y1="${y.toFixed(1)}" x2="${(gutter + plotW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${grid}" stroke-width="1" ${t === 0 ? "" : 'stroke-dasharray="3 4"'}/>`;
    axis += `<text x="${gutter - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="${faint}" font-size="10">${t}</text>`;
  }

  const peakDot =
    pts.length && traffic.peak_value > 0
      ? `<circle cx="${pts[traffic.peak_index][0].toFixed(1)}" cy="${pts[traffic.peak_index][1].toFixed(1)}" r="3.5" fill="${accent}" stroke="${cssVar("--bg-tertiary")}" stroke-width="2"/>`
      : "";

  const id = `tg${Math.random().toString(36).slice(2, 7)}`;
  svg.innerHTML = `
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.32"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient></defs>
    ${axis}
    ${pts.length ? `<path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>` : ""}
    ${peakDot}`;
}

/** Build the latency histogram bars. */
function buildHistogram(svg, histogram) {
  if (!svg) return;
  const bins = histogram.bins || [];
  const rect = svg.getBoundingClientRect();
  const W = rect.width || 320;
  const H = 56;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const max = bins.length ? Math.max(...bins, 1) : 1;
  const bw = W / Math.max(1, bins.length);
  const accent = cssVar("--accent");
  const warning = cssVar("--warning");
  let html = "";
  bins.forEach((v, i) => {
    const bh = (v / max) * (H - 6);
    const tail = i >= histogram.tail_from;
    html += `<rect x="${(i * bw + 2).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${tail ? warning : accent}" opacity="${tail ? 0.85 : 0.7}"/>`;
  });
  svg.innerHTML = html;
}

/** Build the status donut from a status-code map. */
function buildDonut(svg, byStatus) {
  if (!svg) return;
  const buckets = statusBuckets(byStatus);
  const segs = [
    { v: buckets.s2, c: cssVar("--success") },
    { v: buckets.s4, c: cssVar("--warning") },
    { v: buckets.s5, c: cssVar("--danger") },
  ].filter((s) => s.v > 0);
  const total = segs.reduce((s, x) => s + x.v, 0);
  const cx = 43;
  const cy = 43;
  const r = 33;
  const sw = 11;
  const C = 2 * Math.PI * r;
  const successPct = svg.dataset.success;

  let html = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cssVar("--bg-primary")}" stroke-width="${sw}"/>`;
  let off = 0;
  for (const s of segs) {
    const len = total > 0 ? (s.v / total) * C : 0;
    html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.c}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    off += len;
  }
  html += `<text x="${cx}" y="${cy - 1}" text-anchor="middle" fill="${cssVar("--text-primary")}" font-size="16" font-weight="600">${successPct}%</text>`;
  html += `<text x="${cx}" y="${cy + 13}" text-anchor="middle" fill="${cssVar("--text-muted")}" font-size="9">OK</text>`;
  svg.innerHTML = html;
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
 * Format seconds into a human-readable uptime string.
 *
 * @param {number} seconds - Total uptime in seconds.
 * @returns {string} Formatted string like "3d 10h 17m".
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const min = Math.floor((seconds % 3600) / 60);

  if (d > 0) return `${d}d ${h}h ${min}m`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}

/** Format a duration in seconds as "Xm Ys" or "Ys". */
function formatDuration(seconds) {
  if (!seconds) return "—";
  const min = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return min > 0 ? `${min}m ${s}s` : `${s}s`;
}

/** Format "seconds ago" as a relative label, or "—" when null. */
function formatAgo(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
