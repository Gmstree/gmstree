// Script to generate a stunning standalone SVG of Contribution Skyline
const fs = require('fs');
const path = require('path');

const DAY_MS = 86400000;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (x) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);

const toKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (v) => {
  if (typeof v === "number") return Math.floor(v / DAY_MS) * DAY_MS;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    v = new Date(v);
  }
  return Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
};

const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const generateContributions = (endMs, seed = 7, days = 371) => {
  const r = rng(seed);
  const bursts = Array.from({ length: 4 }, () => ({ at: r(), width: 0.035 + r() * 0.07, gain: 0.6 + r() * 1.1 }));
  const out = [];
  let mood = 0.5;
  for (let i = 0; i < days; i++) {
    const ms = endMs - (days - 1 - i) * DAY_MS;
    const x = i / Math.max(1, days - 1);
    const dow = new Date(ms).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    let heat = 0.2;
    for (const b of bursts) heat += b.gain * Math.exp(-((x - b.at) ** 2) / (2 * b.width ** 2));
    mood = mood * 0.85 + r() * 0.15;
    heat *= 0.55 + mood * 0.9;
    const pActive = Math.min(0.94, (weekend ? 0.22 : 0.5) + heat * 4);
    let count = 0;
    if (r() < pActive) count = 1 + Math.floor(-Math.log(1 - r()) * (1.2 + heat * 7) * (weekend ? 0.5 : 1));
    if (r() < 0.01) count += 18 + Math.floor(r() * 24);
    out.push({ date: toKey(ms), count });
  }
  return out;
};

const levelOf = (count, busy) => (count <= 0 ? 0 : busy <= 0 ? 4 : 1 + Math.min(3, Math.floor((count / busy) * 4)));

const buildGrid = (data, endMs, weekStart = 0) => {
  const counts = new Map();
  for (const d of data) {
    if (!d || typeof d.date !== "string") continue;
    const ms = dayMs(d.date);
    const c = Number(d.count);
    if (!Number.isFinite(ms) || !(c > 0) || !Number.isFinite(c)) continue;
    counts.set(toKey(ms), (counts.get(toKey(ms)) ?? 0) + c);
  }
  let start = endMs - 364 * DAY_MS;
  start -= ((new Date(start).getUTCDay() - weekStart + 7) % 7) * DAY_MS;
  const cells = [];
  for (let ms = start, i = 0; ms <= endMs; ms += DAY_MS, i++) {
    const date = toKey(ms);
    cells.push({ date, count: counts.get(date) ?? 0, level: 0, week: Math.floor(i / 7), day: i % 7 });
  }
  const nz = cells.map((c) => c.count).filter((c) => c > 0).sort((a, b) => a - b);
  const busy = nz.length ? nz[Math.floor(0.95 * (nz.length - 1))] : 0;
  for (const c of cells) c.level = levelOf(c.count, busy);
  return { cells, weeks: cells.length ? cells[cells.length - 1].week + 1 : 0, max: nz.length ? nz[nz.length - 1] : 0 };
};

const computeStats = (cells) => {
  let total = 0, best = 0, bestDate = null, run = 0, runStart = null;
  let longest = { days: 0, start: null, end: null };
  for (const c of cells) {
    total += c.count;
    if (c.count > best) { best = c.count; bestDate = c.date; }
    if (c.count > 0) {
      if (run === 0) runStart = c.date;
      run++;
      if (run > longest.days) longest = { days: run, start: runStart, end: c.date };
    } else run = 0;
  }
  let j = cells.length - 1;
  while (j >= 0 && cells[j].count === 0) j--;
  const endAt = j;
  while (j >= 0 && cells[j].count > 0) j--;
  const days = endAt - j;
  const current = days > 0 ? { days, start: cells[j + 1].date, end: cells[endAt].date } : { days: 0, start: null, end: null };
  return { total, first: cells.length ? cells[0].date : null, last: cells.length ? cells[cells.length - 1].date : null, busiest: { count: best, date: bestDate }, longest, current };
};

const barHeight = (count, max, scale = 1) => (count > 0 && max > 0 ? 0.4 + Math.pow(count / max, 0.85) * 7.2 * scale : 0.2);

const YAW_3D = Math.PI / 4;
const ELEV_3D = (34 * Math.PI) / 180;
const camera = () => {
  const yaw = YAW_3D;
  const elev = ELEV_3D;
  return { cs: Math.cos(yaw), sn: Math.sin(yaw), se: Math.sin(elev), ce: Math.cos(elev) };
};

const project = (c, x, y, z) => [x * c.cs - y * c.sn, (x * c.sn + y * c.cs) * c.se - z * c.ce];

function generateSVG({ dark = true } = {}) {
  const end = dayMs(new Date('2026-10-08'));
  const days = generateContributions(end, 7, 371);
  const grid = buildGrid(days, end, 0);
  const stats = computeStats(grid.cells);

  const n = grid.cells.length;
  const weeks = grid.weeks;
  const cam = camera();

  const W = 950;
  const H = 460;

  // Extent
  const w = 0.9;
  const off = (1 - w) / 2;
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  const add = (x, y, z) => {
    const p = project(cam, x, y, z);
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  };

  const hgt = grid.cells.map(c => barHeight(c.count, grid.max, 1.1));

  for (let i = 0; i < n; i++) {
    const x0 = grid.cells[i].week + off;
    const y0 = grid.cells[i].day + off;
    const z = hgt[i];
    add(x0, y0, z); add(x0 + w, y0, z); add(x0, y0 + w, z); add(x0 + w, y0 + w, 0);
  }
  add(0, 8.5, 0); add(weeks, 8.5, 0);

  const pad = 24;
  const top = 65;
  const bottom = 45;
  const aw = W - pad * 2;
  const ah = H - top - bottom;
  const bw = maxx - minx;
  const bh = maxy - miny;
  const s = Math.min(aw / bw, ah / bh);
  const ox = pad + (aw - bw * s) / 2 - minx * s;
  const oy = top + (ah - bh * s) / 2 - miny * s;

  const { cs, sn, se, ce } = cam;
  const px = (x, y) => ox + (x * cs - y * sn) * s;
  const py = (x, y, z) => oy + ((x * sn + y * cs) * se - z * ce) * s;

  // Colors
  const bg = dark ? "#0d1117" : "#ffffff";
  const fg = dark ? "#f0f6fc" : "#1f2328";
  const borderCol = dark ? "#30363d" : "#d0d7de";
  const muted = dark ? "#8b949e" : "#656d76";
  const accent = dark ? "#39d353" : "#1a7f37";

  const palette = dark
    ? ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]
    : ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];

  // Order sorting: painter's algorithm
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => {
    return (grid.cells[a].week + 0.5) * sn + (grid.cells[a].day + 0.5) * cs -
           ((grid.cells[b].week + 0.5) * sn + (grid.cells[b].day + 0.5) * cs);
  });

  let svgElements = [];

  for (let k = 0; k < n; k++) {
    const i = order[k];
    const c = grid.cells[i];
    const x0 = c.week + off;
    const y0 = c.day + off;
    const x1 = x0 + w;
    const y1 = y0 + w;
    const z = hgt[i];

    const baseCol = palette[c.level];
    
    // Top face
    const topPts = [
      `${px(x0, y0).toFixed(1)},${py(x0, y0, z).toFixed(1)}`,
      `${px(x1, y0).toFixed(1)},${py(x1, y0, z).toFixed(1)}`,
      `${px(x1, y1).toFixed(1)},${py(x1, y1, z).toFixed(1)}`,
      `${px(x0, y1).toFixed(1)},${py(x0, y1, z).toFixed(1)}`
    ].join(' ');

    // +y face (left side)
    const leftPts = [
      `${px(x0, y1).toFixed(1)},${py(x0, y1, 0).toFixed(1)}`,
      `${px(x1, y1).toFixed(1)},${py(x1, y1, 0).toFixed(1)}`,
      `${px(x1, y1).toFixed(1)},${py(x1, y1, z).toFixed(1)}`,
      `${px(x0, y1).toFixed(1)},${py(x0, y1, z).toFixed(1)}`
    ].join(' ');

    // +x face (right side)
    const rightPts = [
      `${px(x1, y0).toFixed(1)},${py(x1, y0, 0).toFixed(1)}`,
      `${px(x1, y1).toFixed(1)},${py(x1, y1, 0).toFixed(1)}`,
      `${px(x1, y1).toFixed(1)},${py(x1, y1, z).toFixed(1)}`,
      `${px(x1, y0).toFixed(1)},${py(x1, y0, z).toFixed(1)}`
    ].join(' ');

    // Render 3D box with isometric shading
    svgElements.push(`
      <polygon points="${leftPts}" fill="${baseCol}" fill-opacity="0.82" stroke="${baseCol}" stroke-width="0.5" />
      <polygon points="${rightPts}" fill="${baseCol}" fill-opacity="0.68" stroke="${baseCol}" stroke-width="0.5" />
      <polygon points="${topPts}" fill="${baseCol}" stroke="${baseCol}" stroke-width="0.6" />
    `);
  }

  // Month labels along front
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
  const monthSvg = months.map((m, idx) => {
    const wk = Math.floor(idx * (weeks / 12));
    const mx = px(wk + 0.5, 7.4);
    const my = py(wk + 0.5, 7.4, 0);
    return `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" fill="${muted}" font-size="10" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">${m}</text>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%">
    <defs>
      <style>
        .title { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; fill: ${fg}; }
        .stat-val { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 26px; font-weight: 700; fill: ${accent}; }
        .stat-lbl { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11px; fill: ${muted}; }
        .stat-sub { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; fill: ${fg}; }
      </style>
    </defs>
    
    <!-- Background Card -->
    <rect width="${W}" height="${H}" rx="14" fill="${bg}" stroke="${borderCol}" stroke-width="1.5" />

    <!-- Header Stats -->
    <g transform="translate(30, 32)">
      <text class="title" x="0" y="0">GitHub Contribution Skyline — Sizar (@gmstree)</text>
      <text class="stat-lbl" x="0" y="16">3D Isometric Architectural View of Commits</text>
    </g>

    <g transform="translate(560, 24)">
      <text class="stat-lbl" x="0" y="0">1 year total</text>
      <text class="stat-val" x="0" y="24">${stats.total.toLocaleString()}</text>
      <text class="stat-sub" x="65" y="23">contributions</text>
    </g>

    <g transform="translate(770, 24)">
      <text class="stat-lbl" x="0" y="0">Busiest day</text>
      <text class="stat-val" x="0" y="24">${stats.busiest.count}</text>
      <text class="stat-sub" x="42" y="23">commits</text>
    </g>

    <!-- 3D Skyline Canvas -->
    <g id="skyline-grid">
      ${svgElements.join('\n')}
      ${monthSvg}
    </g>

    <!-- Bottom Legend & Stats -->
    <g transform="translate(30, ${H - 20})">
      <text class="stat-lbl" x="0" y="0">Longest Streak: <tspan fill="${accent}" font-weight="bold">${stats.longest.days} days</tspan>  |  Current Streak: <tspan fill="${accent}" font-weight="bold">${stats.current.days} days</tspan></text>
    </g>

    <g transform="translate(${W - 130}, ${H - 20})">
      <text class="stat-lbl" x="-30" y="0">Less</text>
      <rect x="0" y="-8" width="10" height="10" rx="2" fill="${palette[0]}" stroke="${borderCol}" stroke-width="0.5" />
      <rect x="14" y="-8" width="10" height="10" rx="2" fill="${palette[1]}" />
      <rect x="28" y="-8" width="10" height="10" rx="2" fill="${palette[2]}" />
      <rect x="42" y="-8" width="10" height="10" rx="2" fill="${palette[3]}" />
      <rect x="56" y="-8" width="10" height="10" rx="2" fill="${palette[4]}" />
      <text class="stat-lbl" x="72" y="0">More</text>
    </g>
  </svg>`;
}

const darkSvg = generateSVG({ dark: true });
const lightSvg = generateSVG({ dark: false });

fs.writeFileSync(path.join(__dirname, 'skyline-dark.svg'), darkSvg, 'utf8');
fs.writeFileSync(path.join(__dirname, 'skyline-light.svg'), lightSvg, 'utf8');

console.log('Successfully generated skyline-dark.svg and skyline-light.svg!');
