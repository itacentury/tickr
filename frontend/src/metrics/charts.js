// @ts-nocheck — DOM/SVG-heavy module: checkJs cannot narrow querySelector /
// dataset access without per-callsite casts.
/**
 * SVG chart builders for the metrics dashboard.
 *
 * CSP note: the page runs under `default-src 'self'`, so charts are built as SVG using
 * presentation attributes (fill, d, …) rather than inline styles/scripts.
 */

import { cssVar } from "../dom.js";
import { statusBuckets } from "./formatters.js";

/** Build a small sparkline into the given SVG element. */
export function buildSpark(svg) {
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
export function buildTraffic(svg, traffic) {
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
export function buildHistogram(svg, histogram) {
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
export function buildDonut(svg, byStatus) {
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
