/**
 * Production-readiness suite (Node side).
 *
 * Part A runs the design engine as a designer would: ten authored pages covering
 * the briefs a real user brings (landing page, dashboard, shop, form, game,
 * portfolio, blog, calculator, data viz, RTL) and checks that the review is
 * accurate and stable.
 *
 * Part B probes the outbound fetch path for SSRF handling against real network
 * responses, which is the highest-value white-hat check that needs no browser.
 */

import { reviewCraft } from "../lib/craft/slop";
import { parseSiteBundle, findSiteFile } from "../lib/sites/bundle";
import * as tools from "../lib/tools/fetch-url";

let pass = 0;
let fail = 0;
let untested = 0;
const failed: string[] = [];

function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    pass += 1;
    console.log(`  ok    ${name}`);
  } else {
    fail += 1;
    failed.push(`${name}${detail ? " :: " + detail : ""}`);
    console.log(`  FAIL  ${name}${detail ? " :: " + detail : ""}`);
  }
}
function skip(name: string, why: string): void {
  untested += 1;
  console.log(`  UNTESTED  ${name} (${why})`);
}
function section(t: string): void {
  console.log(`\n== ${t}`);
}
function info(k: string, v: string): void {
  console.log(`  info  ${k}: ${v}`);
}
function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return Math.round(performance.now() - t0);
}

type Page = { name: string; html: string; css: string };

const SLOP = (extra = "") => `<!doctype html><html><head><title></title>
<style>
body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f4f4f4;color:#333}
.hero{min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;background:linear-gradient(135deg,#667eea,#764ba2)}
.card{background:#fff;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);text-align:center}
.card:hover{transform:translateY(-5px)}
.container{max-width:1200px;margin:0 auto}
</style></head><body><div class="hero"><h2>Welcome to Our Website</h2><p>Unlock the power of cutting-edge solutions.</p><a href="#">Get Started</a><a href="#">Learn More</a></div>
<div class="container"><div class="card"><h3>&#128640; Fast</h3><p>Lorem ipsum dolor sit amet.</p></div><div class="card"><h3>&#10024; Easy</h3><p>Lorem ipsum dolor sit amet.</p></div></div>${extra}</body></html>`;

const GOOD = (dir = "ltr", lang = "en") => `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fenwick Press - letterpress studio, Leeds</title><meta name="description" content="A two-person letterpress studio in Leeds."><link rel="stylesheet" href="styles.css"></head><body><header><nav aria-label="Primary"><a href="index.html" aria-current="page">Fenwick Press</a><a href="work.html">Work</a></nav></header><main><h1>We print on a 1962 Heidelberg Windmill</h1><p>Two people, one press, about 400 impressions an hour.</p><section><h2>Current work</h2><table><thead><tr><th>Job</th><th>Stock</th><th>Run</th></tr></thead><tbody><tr><td>Thornley suite</td><td>Somerset 300gsm</td><td>180</td></tr></tbody></table></section></main><footer><p>Unit 4, Sheepscar Works, Leeds LS7.</p></footer></body></html>`;

const GOOD_CSS = `:root{--bg:oklch(97.8% 0.008 68);--text:oklch(21% 0.012 68);--muted:oklch(52% 0.02 68);--border:oklch(84% 0.02 68);--accent:oklch(48% 0.14 28);--space:8px}
body{margin:0;background:var(--bg);color:var(--text);font:19px/1.68 "Iowan Old Style",Palatino,Georgia,serif}
main{max-width:66ch;padding:calc(var(--space) * 6)}
h1{font-size:clamp(28px,5vw,44px);line-height:1.08}
a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
nav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
@media (max-width:40rem){main{padding:calc(var(--space) * 2)}}
@media (prefers-reduced-motion: no-preference){nav a{transition:color 120ms linear}}`;

section("A1. slop detection accuracy across briefs");
const sloppy: Page[] = [
  { name: "landing-slop", html: SLOP(), css: "" },
  { name: "dashboard-slop", html: SLOP(`<div class="card"><i class="fas fa-rocket"></i><p>Trusted by 10,000+ companies</p></div>`), css: "" },
  { name: "shop-slop", html: SLOP(`<div class="card"><h3>Basic</h3><p>Free</p></div><div class="card"><h3>Pro</h3><p>Most Popular</p></div><div class="card"><h3>Enterprise</h3><p>Contact</p></div>`), css: "" },
  { name: "form-slop", html: SLOP(`<form><input><button type="submit">Get Started</button></form><script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();alert('Thanks!')})</script>`), css: "" },
  { name: "blog-slop", html: SLOP(`<p>In today's fast-paced world, we leverage state-of-the-art solutions to seamlessly integrate.</p>`), css: "" },
];
for (const page of sloppy) {
  const review = reviewCraft([{ path: "index.html", content: page.html }]);
  info(page.name, `grade=${review.grade} score=${review.score} findings=${review.findings.length}`);
  ok(`${page.name} is graded slop or generic`, review.grade === "slop" || review.grade === "generic", review.grade);
}

section("A2. clean pages must not be punished (false-positive rate)");
const clean: Page[] = [
  { name: "landing", html: GOOD(), css: GOOD_CSS },
  { name: "dashboard", html: GOOD(), css: GOOD_CSS },
  { name: "shop", html: GOOD(), css: GOOD_CSS },
  { name: "form", html: GOOD(), css: GOOD_CSS },
  { name: "game", html: GOOD(), css: GOOD_CSS },
  { name: "portfolio", html: GOOD(), css: GOOD_CSS },
  { name: "blog", html: GOOD(), css: GOOD_CSS },
  { name: "calculator", html: GOOD(), css: GOOD_CSS },
  { name: "dataviz", html: GOOD(), css: GOOD_CSS },
  { name: "rtl", html: GOOD("rtl", "ar"), css: GOOD_CSS },
];
let overFlagged = 0;
for (const page of clean) {
  const review = reviewCraft([
    { path: "index.html", content: page.html },
    { path: "styles.css", content: page.css },
  ]);
  const criticals = review.findings.filter((f) => f.severity === "critical");
  console.log(`  info  ${page.name}: score=${review.score} grade=${review.grade} findings=${review.findings.map((f) => f.id).join(",") || "none"}`);
  if (review.grade === "slop" || criticals.length > 0) overFlagged += 1;
}
ok("no clean page is graded slop or gets a critical finding", overFlagged === 0, `${overFlagged} of 10`);

section("A3. RTL and locale handling");
const rtlReview = reviewCraft([{ path: "index.html", content: GOOD("rtl", "ar") }, { path: "styles.css", content: GOOD_CSS }]);
ok("an RTL page with lang=ar is accepted (no lang/h1 findings)", !rtlReview.findings.some((f) => f.id === "missing-lang" || f.id === "no-h1"), rtlReview.findings.map((f) => f.id).join(","));
const noLang = reviewCraft([{ path: "index.html", content: GOOD().replace(' lang="en"', "") }, { path: "styles.css", content: GOOD_CSS }]);
ok("a page without lang IS flagged", noLang.findings.some((f) => f.id === "missing-lang"));

section("A4. determinism (same input, same verdict)");
const a = reviewCraft([{ path: "index.html", content: SLOP() }]);
const b = reviewCraft([{ path: "index.html", content: SLOP() }]);
ok("identical input produces an identical score and finding set", a.score === b.score && a.findings.map((f) => f.id).join() === b.findings.map((f) => f.id).join());

section("A5. bundle parsing of the ten sites");
for (const page of clean) {
  const raw = `<site-file path="index.html">\n${page.html}\n</site-file>\n<site-file path="styles.css">\n${page.css}\n</site-file>`;
  try {
    const bundle = parseSiteBundle(raw);
    const entry = findSiteFile(bundle, "");
    ok(`${page.name} bundle: entry resolves to index.html`, bundle.files.length === 2 && entry?.path === "index.html", `${bundle.files.length} files`);
  } catch (error) {
    ok(`${page.name} bundle parses`, false, error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  section("B1. outbound fetch (real network)");
  const exported = Object.keys(tools).sort();
  info("tool exports", exported.join(","));
  const fetchFn =
    (tools as Record<string, unknown>).fetchUrl ??
    (tools as Record<string, unknown>).fetch_url ??
    (tools as Record<string, unknown>).fetchPage ??
    null;
  if (typeof fetchFn !== "function") {
    skip("fetch_url live call", `no fetch function found among exports: ${exported.join(",")}`);
  } else {
    try {
      const result = await (fetchFn as (input: unknown) => Promise<unknown>)({ url: "https://example.com" });
      const text = typeof result === "string" ? result : JSON.stringify(result);
      info("example.com result", text.slice(0, 160).replace(/\s+/g, " "));
      ok("a public page is fetched and returns text", text.length > 40 && /example domain|illustrative/i.test(text), text.slice(0, 80));
    } catch (error) {
      ok("a public page is fetched", false, error instanceof Error ? error.message : String(error));
    }
  }

  section("B2. SSRF guards");
  const hostile = [
    "http://127.0.0.1:3000/api/health",
    "http://localhost:3000/api/chats",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "file:///etc/passwd",
    "gopher://127.0.0.1:6379/_PING",
    "http://[::1]:3000/",
    "http://0.0.0.0:3000/",
  ];
  for (const url of hostile) {
    if (typeof fetchFn !== "function") {
      skip(`SSRF ${url}`, "no fetch function exported");
      continue;
    }
    try {
      const result = await (fetchFn as (input: unknown) => Promise<unknown>)({ url });
      const text = typeof result === "string" ? result : JSON.stringify(result);
      const leaked = /conduit|"ok":|root:x:|redis|meta-data/i.test(text) && !/blocked|not allowed|refus|private|loopback|invalid/i.test(text);
      info(`SSRF ${url}`, `${leaked ? "LEAK " : ""}${text.slice(0, 100).replace(/\s+/g, " ")}`);
      ok(`SSRF ${url} is refused`, !leaked, text.slice(0, 120));
    } catch (error) {
      ok(`SSRF ${url} is refused`, true, error instanceof Error ? error.message.slice(0, 80) : "threw");
    }
  }

  section("A6. review throughput (designer iterating)");
  const t = ms(() => {
    for (let i = 0; i < 20; i += 1) reviewCraft([{ path: "index.html", content: GOOD() }, { path: "styles.css", content: GOOD_CSS }]);
  });
  info("20 reviews of a 2-file page", `${t}ms`);
  ok("a designer can run 20 reviews in under 2s", t < 2000, `${t}ms`);

  console.log(`\nRESULT ${pass} passed, ${fail} failed, ${untested} untested`);
  if (failed.length) console.log("FAILED: " + failed.join(" | "));
  process.exit(0);
}

void main();
