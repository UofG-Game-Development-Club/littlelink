/**
 * Guelph Game Dev links: view and click tracking.
 *
 *   POST /api/hit   records a page view or a button click (sent by js/track.js)
 *   GET  /stats     password-protected stats page (password = STATS_PASSWORD secret)
 *
 * Every other path is a normal file from the site and never reaches this code.
 *
 * Privacy: no cookies and no IP addresses are stored. Unique visitors are counted
 * with a hash that uses a random salt which is replaced every day (the old one is
 * deleted), so a visitor can't be followed across days or traced back to an IP.
 */

const TZ = "America/Toronto";
const RANGES = { "7": "7 days", "30": "30 days", "90": "90 days", all: "All time" };
const DEFAULT_RANGE = "30";
const VIEW_COLOR = "#4f8fe0";
const CLICK_COLOR = "#e2604c";
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|python|curl|wget|httpclient|lighthouse/i;
const SOURCE_ALIASES = {
  ig: "Instagram", insta: "Instagram", instagram: "Instagram",
  dc: "Discord", discord: "Discord",
  li: "LinkedIn", linkedin: "LinkedIn",
  qr: "QR code", poster: "Poster", email: "Email",
};
const REFERRERS = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)discord(app)?\.com$/, "Discord"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)(facebook\.com|fb\.me)$/, "Facebook"],
  [/^t\.co$|(^|\.)(x|twitter)\.com$/, "X"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)uoguelph\.ca$/, "UofG"],
  [/(^|\.)gryphgame\.dev$/, "gryphgame.dev"],
];

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/hit") return handleHit(request, env);
    if (pathname === "/stats" || pathname === "/stats/") return handleStats(request, env);
    return env.ASSETS.fetch(request);
  },
};

// ---------------------------------------------------------------- recording

async function handleHit(request, env) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });

  const ua = request.headers.get("User-Agent") || "";
  if (!env.DB || BOT_UA.test(ua)) return new Response(null, { status: 204 });

  const text = await request.text();
  if (text.length > 2000) return new Response(null, { status: 413 });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const type = body.t === "click" ? "click" : body.t === "view" ? "view" : null;
  if (!type) return new Response(null, { status: 400 });

  const label = type === "click" ? clean(body.label, 80) || "(unnamed)" : null;
  const href = type === "click" ? clean(body.href, 300) : null;

  try {
    const db = env.DB;
    await ensureSchema(db);
    const day = dayInToronto();
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const visitor = (await sha256(`${await dailySalt(db, day)}|${ip}|${ua}`)).slice(0, 16);
    await db
      .prepare("INSERT INTO events (ts, day, type, label, href, source, country, device, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(Math.floor(Date.now() / 1000), day, type, label, href, sourceOf(body, ua, url.host),
        request.cf?.country || null, deviceOf(ua), visitor)
      .run();
  } catch (e) {
    console.error("Couldn't record hit", e);
  }
  return new Response(null, { status: 204 });
}

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS events (
      id      INTEGER PRIMARY KEY,
      ts      INTEGER NOT NULL,
      day     TEXT NOT NULL,
      type    TEXT NOT NULL,
      label   TEXT,
      href    TEXT,
      source  TEXT,
      country TEXT,
      device  TEXT,
      visitor TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS events_day_type ON events (day, type)"),
    db.prepare("CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, value TEXT NOT NULL)"),
  ]);
  schemaReady = true;
}

let saltCache = { day: "", value: "" };
async function dailySalt(db, day) {
  if (saltCache.day === day) return saltCache.value;
  let row = await db.prepare("SELECT value FROM salts WHERE day = ?").bind(day).first();
  if (!row) {
    const fresh = crypto.randomUUID() + crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO salts (day, value) VALUES (?, ?)").bind(day, fresh),
      db.prepare("DELETE FROM salts WHERE day < ?").bind(day),
    ]);
    row = await db.prepare("SELECT value FROM salts WHERE day = ?").bind(day).first();
  }
  saltCache = { day, value: row.value };
  return row.value;
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function deviceOf(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return "Tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "Mobile";
  return "Desktop";
}

function sourceOf(body, ua, host) {
  const src = String(body.src || "").toLowerCase().replace(/[^a-z0-9 _-]/g, "").trim().slice(0, 40);
  if (src) return SOURCE_ALIASES[src] || src.charAt(0).toUpperCase() + src.slice(1);
  // in-app browsers say where they are even when they hide the referrer
  if (/Instagram/.test(ua)) return "Instagram";
  if (/FBAN|FBAV/.test(ua)) return "Facebook";
  if (/LinkedInApp/.test(ua)) return "LinkedIn";
  if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) return "TikTok";
  let ref;
  try {
    ref = new URL(String(body.ref || "")).hostname.toLowerCase();
  } catch {
    return "Direct";
  }
  if (!ref || ref === host) return "Direct";
  ref = ref.replace(/^(www|m|l|lm|out)\./, "");
  for (const [re, name] of REFERRERS) if (re.test(ref)) return name;
  return ref.slice(0, 60);
}

// ---------------------------------------------------------------- stats page

async function handleStats(request, env) {
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
  if (!env.DB || !env.STATS_PASSWORD) {
    const missing = [!env.DB && "the DB database binding", !env.STATS_PASSWORD && "the STATS_PASSWORD secret"].filter(Boolean);
    return new Response(page("Stats setup", `<section class="card empty"><h2>Almost there</h2>
      <p>Stats need ${missing.join(" and ")} on this Worker in Cloudflare. The README in the repo walks through it.</p></section>`),
      { status: 503, headers });
  }
  if (!(await authorized(request, env))) {
    return new Response("Password required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Guelph Game Dev link stats", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }

  const db = env.DB;
  await ensureSchema(db);
  const url = new URL(request.url);
  const range = RANGES[url.searchParams.get("range")] ? url.searchParams.get("range") : DEFAULT_RANGE;
  const today = dayInToronto();

  let since;
  if (range === "all") {
    const first = await db.prepare("SELECT MIN(day) AS d FROM events").first();
    since = first?.d || today;
  } else {
    since = addDays(today, -(Number(range) - 1));
  }

  const q = (sql) => db.prepare(sql).bind(since);
  const [totals, daily, links, sources, countries, devices] = (await db.batch([
    q("SELECT type, COUNT(*) AS n, COUNT(DISTINCT day || visitor) AS u FROM events WHERE day >= ? GROUP BY type"),
    q("SELECT day, type, COUNT(*) AS n FROM events WHERE day >= ? GROUP BY day, type"),
    q("SELECT label, COUNT(*) AS n, COUNT(DISTINCT day || visitor) AS u FROM events WHERE type = 'click' AND day >= ? GROUP BY label ORDER BY n DESC LIMIT 25"),
    q("SELECT source AS k, COUNT(*) AS n FROM events WHERE type = 'view' AND day >= ? GROUP BY source ORDER BY n DESC LIMIT 8"),
    q("SELECT country AS k, COUNT(*) AS n FROM events WHERE type = 'view' AND day >= ? GROUP BY country ORDER BY n DESC LIMIT 8"),
    q("SELECT device AS k, COUNT(*) AS n FROM events WHERE type = 'view' AND day >= ? GROUP BY device ORDER BY n DESC"),
  ])).map((r) => r.results);

  const t = Object.fromEntries(totals.map((r) => [r.type, r]));
  const views = t.view?.n || 0;
  const uniques = t.view?.u || 0;
  const clicks = t.click?.n || 0;

  const days = [];
  for (let d = since; d <= today; d = addDays(d, 1)) days.push(d);
  const byDay = Object.fromEntries(days.map((d) => [d, { view: 0, click: 0 }]));
  for (const r of daily) if (byDay[r.day]) byDay[r.day][r.type] = r.n;
  const series = days.map((d) => ({ day: d, views: byDay[d].view, clicks: byDay[d].click }));

  const tabs = Object.entries(RANGES)
    .map(([key, name]) => `<a class="tab${key === range ? " on" : ""}" href="?range=${key}"${key === range ? ' aria-current="page"' : ""}>${name}</a>`)
    .join("");

  let body;
  if (!views && !clicks) {
    body = `<nav class="tabs" aria-label="Date range">${tabs}</nav>
      <section class="card empty"><h2>No visits yet</h2>
      <p>Once people open <a href="/">links.gryphgame.dev</a>, views and clicks show up here.</p>
      <p class="muted">Tip: share <code>links.gryphgame.dev/?src=insta</code> in the Instagram bio (or <code>?src=qr</code> on posters) to see exactly where visitors come from.</p></section>`;
  } else {
    body = `<nav class="tabs" aria-label="Date range">${tabs}</nav>
      <section class="tiles">
        ${tile("Views", fmt(views))}
        ${tile("Unique visitors", fmt(uniques))}
        ${tile("Clicks", fmt(clicks))}
        ${tile("Click rate", views ? pct(clicks / views) : "-", "clicks ÷ views")}
      </section>
      <section class="card">
        <div class="card-head"><h2>Views and clicks per day</h2>
          <ul class="legend"><li><i style="background:${VIEW_COLOR}"></i>Views</li><li><i style="background:${CLICK_COLOR}"></i>Clicks</li></ul></div>
        ${lineChart(series)}
        <details><summary>Show as a table</summary>${dailyTable(series)}</details>
      </section>
      <section class="card">
        <h2>Clicks per link</h2>
        ${linksTable(links, views)}
      </section>
      <section class="grid3">
        ${breakdown("Where visitors came from", sources, views, (k) => esc(k || "Direct"))}
        ${breakdown("Countries", countries, views, countryName)}
        ${breakdown("Devices", devices, views, (k) => esc(k || "Unknown"))}
      </section>`;
  }
  return new Response(page("Link stats", body), { headers });
}

async function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let password;
  try {
    const bytes = Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0));
    password = new TextDecoder().decode(bytes).split(":").slice(1).join(":");
  } catch {
    return false;
  }
  const [a, b] = await Promise.all([sha256(password), sha256(env.STATS_PASSWORD)]);
  const enc = new TextEncoder();
  return crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b));
}

// ---------------------------------------------------------------- page pieces

function tile(label, value, note = "") {
  return `<div class="tile"><span class="tile-label">${label}</span><span class="tile-value">${value}</span>${note ? `<span class="tile-note">${note}</span>` : ""}</div>`;
}

function linksTable(rows, views) {
  if (!rows.length) return `<p class="muted">No clicks in this range yet.</p>`;
  const max = Math.max(...rows.map((r) => r.n));
  return `<table class="data"><thead><tr><th scope="col">Link</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">People</th><th scope="col" class="num">Click rate</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><th scope="row"><span class="bar-label">${esc(r.label)}</span>
      <span class="bar" style="--w:${(r.n / max) * 100}%;--c:${CLICK_COLOR}"></span></th>
      <td class="num">${fmt(r.n)}</td><td class="num">${fmt(r.u)}</td><td class="num">${views ? pct(r.n / views) : "-"}</td></tr>`).join("")}
    </tbody></table>`;
}

function breakdown(title, rows, total, name) {
  const items = rows.length
    ? rows.map((r) => `<li><span class="row"><span>${name(r.k)}</span><span class="num">${fmt(r.n)}</span></span>
        <span class="bar" style="--w:${total ? (r.n / total) * 100 : 0}%;--c:${VIEW_COLOR}"></span></li>`).join("")
    : `<li class="muted">Nothing yet</li>`;
  return `<section class="card"><h2>${title}</h2><ul class="breakdown">${items}</ul></section>`;
}

function dailyTable(series) {
  return `<table class="data compact"><thead><tr><th scope="col">Day</th><th scope="col" class="num">Views</th><th scope="col" class="num">Clicks</th></tr></thead><tbody>
    ${[...series].reverse().map((s) => `<tr><td>${longDay(s.day)}</td><td class="num">${fmt(s.views)}</td><td class="num">${fmt(s.clicks)}</td></tr>`).join("")}
  </tbody></table>`;
}

function lineChart(series) {
  const W = 720, H = 260, L = 44, R = 64, T = 14, B = 30;
  const pw = W - L - R, ph = H - T - B;
  const n = series.length;
  const { max, step } = niceScale(Math.max(...series.map((s) => Math.max(s.views, s.clicks))));
  const x = (i) => L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v) => T + ph - (v / max) * ph;

  const grid = Array.from({ length: max / step + 1 }, (_, k) => k * step).map((v) =>
    `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" class="grid${v === 0 ? " base" : ""}"/>
      <text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${fmt(v)}</text>`).join("");

  // evenly spaced dates (every 1, 2, 3... days), always ending on the last day
  const every = Math.max(1, Math.ceil((n - 1) / 5));
  const tickIdx = [];
  for (let i = 0; i < n; i += every) if (n - 1 - i >= every / 2 || i === n - 1) tickIdx.push(i);
  if (tickIdx[tickIdx.length - 1] !== n - 1) tickIdx.push(n - 1);
  const ticks = tickIdx
    .map((i) => `<text x="${x(i)}" y="${H - 8}" class="axis" text-anchor="${n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${shortDay(series[i].day)}</text>`)
    .join("");

  const path = (key) => series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join("");
  const dots = n <= 14
    ? series.map((s, i) => `<circle cx="${x(i)}" cy="${y(s.views)}" r="3.5" fill="${VIEW_COLOR}" class="dot"/><circle cx="${x(i)}" cy="${y(s.clicks)}" r="3.5" fill="${CLICK_COLOR}" class="dot"/>`).join("")
    : "";

  // end labels, nudged apart if the two lines finish close together
  const last = series[n - 1];
  let yv = y(last.views), yc = y(last.clicks);
  if (Math.abs(yv - yc) < 14) {
    const mid = (yv + yc) / 2;
    const viewsOnTop = last.views >= last.clicks;
    yv = mid + (viewsOnTop ? -7 : 7);
    yc = mid + (viewsOnTop ? 7 : -7);
  }
  const ends = `<text x="${x(n - 1) + 8}" y="${yv + 4}" class="end">Views</text><text x="${x(n - 1) + 8}" y="${yc + 4}" class="end">Clicks</text>`;

  const data = esc(JSON.stringify(series.map((s) => [longDay(s.day), s.views, s.clicks])));
  return `<div class="chart" data-series="${data}" data-l="${L}" data-pw="${pw}" data-w="${W}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart of daily views and clicks. The same numbers are in the table below.">
      ${grid}${ticks}
      <path d="${path("views")}" stroke="${VIEW_COLOR}" class="line"/>
      <path d="${path("clicks")}" stroke="${CLICK_COLOR}" class="line"/>
      ${dots}${ends}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>
      <circle class="hover-dot" r="5" fill="${VIEW_COLOR}" visibility="hidden" data-k="1"/>
      <circle class="hover-dot" r="5" fill="${CLICK_COLOR}" visibility="hidden" data-k="2"/>
      <rect class="hit" x="${L - 10}" y="${T}" width="${pw + 20}" height="${ph}" fill="transparent"/>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}

const HOVER_SCRIPT = `
document.querySelectorAll(".chart").forEach(function (chart) {
  var s = JSON.parse(chart.dataset.series), L = +chart.dataset.l, pw = +chart.dataset.pw, W = +chart.dataset.w;
  var svg = chart.querySelector("svg"), cross = chart.querySelector(".cross"), tip = chart.querySelector(".tip");
  var dots = chart.querySelectorAll(".hover-dot"), paths = chart.querySelectorAll(".line");
  var pts = [0, 1].map(function (k) {
    var p = paths[k], out = [], d = p.getAttribute("d").slice(1).split("L");
    d.forEach(function (xy) { var a = xy.split(","); out.push([+a[0], +a[1]]); });
    return out;
  });
  function show(e) {
    var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
    var i = s.length === 1 ? 0 : Math.max(0, Math.min(s.length - 1, Math.round(((px - L) / pw) * (s.length - 1))));
    var cx = pts[0][i][0];
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    dots.forEach(function (d, k) { d.setAttribute("cx", cx); d.setAttribute("cy", pts[k][i][1]); d.setAttribute("visibility", "visible"); });
    tip.innerHTML = "<strong>" + s[i][0] + "</strong><span><i class='v'></i>Views <b>" + s[i][1].toLocaleString() + "</b></span><span><i class='c'></i>Clicks <b>" + s[i][2].toLocaleString() + "</b></span>";
    tip.hidden = false;
    var left = cx * (r.width / W), tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(r.width - tw, left - tw / 2)) + "px";
  }
  function hide() { cross.setAttribute("visibility", "hidden"); dots.forEach(function (d) { d.setAttribute("visibility", "hidden"); }); tip.hidden = true; }
  var hit = chart.querySelector(".hit");
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
});`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} | Guelph Game Dev</title>
<link rel="icon" type="image/png" href="/images/logo.png">
<style>
@font-face{font-family:"Open Sans";font-weight:400;font-display:swap;src:url("/fonts/open-sans-v34-vietnamese_latin-ext_latin_hebrew_greek-ext_greek_cyrillic-ext_cyrillic-regular.woff2") format("woff2")}
@font-face{font-family:"Open Sans";font-weight:700;font-display:swap;src:url("/fonts/open-sans-v34-vietnamese_latin-ext_latin_hebrew_greek-ext_greek_cyrillic-ext_cyrillic-700.woff2") format("woff2")}
:root{--bg:#170a15;--surface:#241020;--line:rgba(255,241,234,.1);--ink:#fff1ea;--ink-2:#e2c3bc;--ink-3:#b8958f;--coral:#e8654f;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);background-image:radial-gradient(ellipse 80% 40% at 50% 0%,rgba(232,101,79,.16),transparent 70%);color:var(--ink);font:15px/1.5 "Open Sans",system-ui,sans-serif;min-height:100vh}
a{color:#f6a58a}
main{max-width:980px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;align-items:center;gap:14px;margin-bottom:22px}
header img{width:48px;height:48px;border-radius:50%;box-shadow:0 0 0 3px var(--coral)}
header h1{font-size:1.5rem;margin:0;line-height:1.2}
header p{margin:0;color:var(--ink-3);font-size:.85rem}
h2{font-size:1rem;margin:0 0 12px}
.muted{color:var(--ink-3)}
code{background:rgba(255,255,255,.07);padding:1px 5px;border-radius:4px;font-size:.88em}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.tab{padding:6px 12px;border-radius:999px;border:1px solid var(--line);color:var(--ink-2);text-decoration:none;font-size:.88rem}
.tab:hover{border-color:var(--coral)}
.tab.on{background:var(--coral);border-color:var(--coral);color:#1b0a17;font-weight:700}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px}
.tile,.card{background:var(--surface);border:1px solid var(--line);border-radius:12px}
.tile{padding:14px 16px;display:flex;flex-direction:column}
.tile-label{color:var(--ink-2);font-size:.85rem}
.tile-value{font-size:1.9rem;font-weight:700;line-height:1.25;font-variant-numeric:tabular-nums}
.tile-note{color:var(--ink-3);font-size:.75rem}
.card{padding:16px 18px;margin-bottom:12px}
.card-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.legend{display:flex;gap:14px;list-style:none;margin:0 0 8px;padding:0;color:var(--ink-2);font-size:.85rem}
.legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
.chart{position:relative}
.chart svg{width:100%;height:auto;display:block;overflow:visible}
.grid{stroke:var(--line);stroke-width:1}
.grid.base{stroke:rgba(255,241,234,.25)}
.axis{fill:var(--ink-3);font-size:11px;font-variant-numeric:tabular-nums}
.end{fill:var(--ink-2);font-size:12px;font-weight:700}
.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.grid,.cross{vector-effect:non-scaling-stroke}
.dot{stroke:var(--surface);stroke-width:2}
.hover-dot{stroke:var(--surface);stroke-width:2;pointer-events:none}
.cross{stroke:rgba(255,241,234,.35);stroke-width:1;pointer-events:none}
.hit{cursor:crosshair}
.tip{position:absolute;top:0;background:#140812;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:.82rem;pointer-events:none;display:flex;flex-direction:column;gap:2px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.4)}
.tip[hidden]{display:none}
.tip i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.tip i.v{background:${VIEW_COLOR}}.tip i.c{background:${CLICK_COLOR}}
.tip b{margin-left:4px}
details{margin-top:8px}
summary{cursor:pointer;color:var(--ink-3);font-size:.85rem}
table.data{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.data th,.data td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line);font-weight:400;vertical-align:middle}
.data thead th{color:var(--ink-3);font-size:.8rem;padding-top:0}
.data tbody tr:last-child th,.data tbody tr:last-child td{border-bottom:0}
.data .num{text-align:right;white-space:nowrap}
.data.compact td{padding:5px 6px;font-size:.88rem}
.bar-label{display:block;margin-bottom:5px}
.bar{display:block;height:6px;width:var(--w);min-width:3px;background:var(--c);border-radius:0 3px 3px 0}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.grid3 .card{margin-bottom:0}
.breakdown{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.breakdown .row{display:flex;justify-content:space-between;gap:8px;font-size:.9rem;margin-bottom:4px}
.empty{text-align:center;padding:40px 18px}
footer{margin-top:22px;color:var(--ink-3);font-size:.8rem;text-align:center}
@media (max-width:760px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.grid3{grid-template-columns:1fr}.tile-value{font-size:1.5rem}}
@media (max-width:560px){.axis{font-size:21px}.end{font-size:20px}.dot{r:6}.hover-dot{r:8}}
</style></head><body><main>
<header><img src="/images/logo.png" alt=""><div><h1>${title}</h1><p>links.gryphgame.dev · times in Toronto</p></div></header>
${body}
<footer>Bots are left out. No cookies or IP addresses are stored.</footer>
</main><script>${HOVER_SCRIPT}</script></body></html>`;
}

// ---------------------------------------------------------------- helpers

function dayInToronto(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shortDay(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function longDay(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// round gridline steps (1, 2, 5, 10, 20, 50...) with at most 5 of them
function niceScale(top) {
  top = Math.max(4, top);
  const p = 10 ** Math.floor(Math.log10(top / 5));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => top / s <= 5);
  return { step, max: Math.ceil(top / step) * step };
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function pct(f) {
  const v = f * 100;
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;
}

let regionNames;
function countryName(code) {
  if (!code || code === "XX" || code === "T1") return "Unknown";
  const flag = String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return `${flag} ${esc(regionNames.of(code))}`;
  } catch {
    return `${flag} ${esc(code)}`;
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
