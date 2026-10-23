/**
 * Craft engine self-check. Run with `npm run craft:check`.
 *
 * Covers the three pure layers that decide whether generated work looks
 * designed or generated: the art-direction resolver, the slop detector, and the
 * multi-file site bundle. Exits non-zero on the first failure.
 */
import { craftBrief, siteFormatBrief } from "../lib/craft/brief";
import { DIRECTIONS, resolveCraftSpec, specCss } from "../lib/craft/directions";
import { detectDesignIntent } from "../lib/craft/intent";
import { reviewCraft } from "../lib/craft/slop";
import {
  findSiteFile,
  inlineSite,
  normalizeSitePath,
  parseSiteBundle,
  serializeSiteBundle,
  summarizeSite,
} from "../lib/sites/bundle";

let passed = 0;
let total = 0;

function check(name: string, condition: boolean, detail?: string): void {
  total += 1;
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* 1. The canonical slop page is caught                                */
/* ------------------------------------------------------------------ */

const SLOP_PAGE = `<!DOCTYPE html>
<html>
<head>
  <title></title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; background: #f4f4f4; }
    .hero {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .card {
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      padding: 20px;
      text-align: center;
      transition: all 0.3s ease;
    }
    .card:hover { transform: translateY(-5px); box-shadow: 0 10px 20px rgba(0,0,0,0.15); }
    .cta { text-align: center; }
    .footer { text-align: center; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="container">
      <h2>Welcome to Our Website</h2>
      <p>Unlock the power of cutting-edge solutions that revolutionize the way you work.</p>
      <a href="#">Get Started</a>
      <a href="#">Learn More</a>
    </div>
  </div>
  <div class="container">
    <div class="card"><h3>🚀 Fast</h3><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></div>
    <div class="card"><h3>✨ Easy</h3><p>Lorem ipsum dolor sit amet.</p></div>
    <div class="card"><h3>💡 Smart</h3><p>Trusted by 10,000+ companies worldwide.</p></div>
    <div class="card"><img src="https://via.placeholder.com/400x300"></div>
    <div class="card"><i class="fas fa-rocket"></i></div>
    <div class="card"><a href="#">Get Started</a></div>
  </div>
  <div class="footer"><p>© 2024 Company Name. All rights reserved.</p></div>
  <script>
    document.querySelector('form')?.addEventListener('submit', function(e) {
      e.preventDefault();
      alert('Thanks for subscribing!');
    });
  </script>
</body>
</html>`;

{
  const review = reviewCraft([{ path: "index.html", content: SLOP_PAGE }]);
  const ids = new Set(review.findings.map((finding) => finding.id));

  check(
    "slop page is graded slop",
    review.grade === "slop",
    `grade ${review.grade}, score ${review.score}`
  );
  check("slop page scores low", review.score <= 25, `score ${review.score}`);
  check("violet gradient caught", ids.has("violet-gradient"));
  check("giveaway font stack caught", ids.has("ai-font-stack"));
  check("CDN dependency caught", ids.has("cdn-dependency"));
  check("lorem ipsum caught", ids.has("lorem-ipsum"));
  check("marketing cliche caught", ids.has("marketing-cliche"));
  check("welcome-to-our caught", ids.has("welcome-to-our"));
  check("emoji icons caught", ids.has("emoji-feature-icons"));
  check("default card shadow caught", ids.has("default-card-shadow"));
  check("hover lift caught", ids.has("hover-lift"));
  check("placeholder image caught", ids.has("placeholder-images"));
  check("fake social proof caught", ids.has("fake-social-proof"));
  check("placeholder footer caught", ids.has("copyright-placeholder"));
  check("font awesome markup caught", ids.has("fontawesome-markup"));
  check("alert() caught", ids.has("alert-usage"));
  check("dead links caught", ids.has("dead-links"));
  check("generic CTA caught", ids.has("generic-cta"));
  check("centred everything caught", ids.has("centered-everything"));
  check("100vh hero caught", ids.has("vh-hero"));
  check("1200px container caught", ids.has("stock-container"));
  check("reflex greys caught", ids.has("hex-greys"));
  check("missing lang caught", ids.has("missing-lang"));
  check("missing viewport caught", ids.has("missing-viewport"));
  check("empty title caught", ids.has("missing-title"));
  check("missing alt caught", ids.has("missing-alt"));
  check("no h1 caught", ids.has("no-h1"));
  check("div soup caught", ids.has("div-soup"));
  check("reduced-motion gap caught", ids.has("no-reduced-motion"));
  check("no media queries caught", ids.has("no-responsive"));
  check("no tokens caught", ids.has("no-tokens"));
  check("brief is produced", review.brief.length > 200 && review.brief.includes("Do this:"));
}

/* ------------------------------------------------------------------ */
/* 2. Crafted work is not punished                                     */
/* ------------------------------------------------------------------ */

const GOOD_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fenwick Press — letterpress studio, Leeds</title>
  <meta name="description" content="A two-person letterpress studio in Leeds, printing on a 1962 Heidelberg.">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <nav aria-label="Primary">
      <a href="index.html" aria-current="page">Fenwick Press</a>
      <a href="work.html">Work</a>
      <a href="contact.html">Contact</a>
    </nav>
  </header>
  <main>
    <h1>We print on a 1962 Heidelberg Windmill</h1>
    <p>Two people, one press, about 400 impressions an hour. We set metal and polymer type for
      stationery, invitations and short-run books.</p>
    <section>
      <h2>Current work</h2>
      <table>
        <thead><tr><th>Job</th><th>Stock</th><th>Run</th></tr></thead>
        <tbody>
          <tr><td>Thornley wedding suite</td><td>Somerset 300gsm</td><td>180</td></tr>
          <tr><td>Hollins poetry pamphlet</td><td>Zerkall 145gsm</td><td>240</td></tr>
        </tbody>
      </table>
    </section>
  </main>
  <footer><p>Unit 4, Sheepscar Works, Leeds LS7. Open Thursdays by appointment.</p></footer>
</body>
</html>`;

const GOOD_CSS = `:root {
  --bg: oklch(97.8% 0.008 68);
  --text: oklch(21% 0.012 68);
  --muted: oklch(52% 0.02 68);
  --border: oklch(84% 0.02 68);
  --accent: oklch(48% 0.14 28);
  --space: 8px;
  --step-0: 19px;
  --step-1: 24px;
  --measure: 66ch;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: var(--step-0)/1.68 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
}
main { max-width: var(--measure); padding: calc(var(--space) * 6) calc(var(--space) * 3); }
h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.08; letter-spacing: -0.015em; margin: 0 0 calc(var(--space) * 3); }
h2 { font-size: var(--step-1); margin: calc(var(--space) * 6) 0 calc(var(--space) * 2); }
nav { display: flex; gap: calc(var(--space) * 3); border-bottom: 1px solid var(--border); padding: calc(var(--space) * 2) calc(var(--space) * 3); }
nav a { color: var(--muted); text-decoration: none; }
nav a[aria-current="page"] { color: var(--text); }
nav a:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
a:focus-visible, nav a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
table { border-collapse: collapse; width: 100%; }
th { text-align: left; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
th, td { border-bottom: 1px solid var(--border); padding: calc(var(--space) * 1.5) 0; }
td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
footer { border-top: 1px solid var(--border); padding: calc(var(--space) * 3); color: var(--muted); font-size: 15px; }
@media (max-width: 40rem) {
  nav { flex-wrap: wrap; gap: calc(var(--space) * 2); }
  main { padding: calc(var(--space) * 4) calc(var(--space) * 2); }
}
@media (prefers-reduced-motion: no-preference) {
  nav a { transition: color 120ms linear; }
}`;

{
  const review = reviewCraft([
    { path: "index.html", content: GOOD_PAGE },
    { path: "styles.css", content: GOOD_CSS },
  ]);
  const criticals = review.findings.filter((finding) => finding.severity === "critical");
  check(
    "crafted page has no criticals",
    criticals.length === 0,
    criticals.map((finding) => finding.id).join(", ")
  );
  check(
    "crafted page scores well",
    review.score >= 85,
    `score ${review.score}: ${review.findings.map((f) => f.id).join(", ")}`
  );
  check(
    "crafted page is not graded slop",
    review.grade === "exceptional" || review.grade === "solid",
    review.grade
  );
}

/* ------------------------------------------------------------------ */
/* 3. Art direction: deterministic, varied, and never the AI default   */
/* ------------------------------------------------------------------ */

{
  const first = resolveCraftSpec("chat-1:build me a landing page");
  const again = resolveCraftSpec("chat-1:build me a landing page");
  check(
    "same seed resolves identically",
    first.direction.slug === again.direction.slug && first.palette.hue === again.palette.hue
  );

  const other = resolveCraftSpec("chat-2:build me a portfolio");
  const varied =
    first.direction.slug !== other.direction.slug || first.palette.hue !== other.palette.hue;
  check("different seeds vary", varied);

  const slugs = new Set<string>();
  const hues: number[] = [];
  for (let index = 0; index < 400; index += 1) {
    const spec = resolveCraftSpec(`seed-${index}`);
    slugs.add(spec.direction.slug);
    hues.push(spec.palette.hue);
  }
  check(
    "every direction is reachable",
    slugs.size === DIRECTIONS.length,
    `${slugs.size}/${DIRECTIONS.length}`
  );
  const inAiBand = hues.filter((hue) => hue >= 248 && hue <= 278).length;
  check(
    "hues avoid the AI indigo band",
    inAiBand === 0,
    `${inAiBand} of ${hues.length} landed in 248-278deg`
  );

  const pinned = resolveCraftSpec("anything", { preferred: "swiss-editorial" });
  check("direction can be pinned", pinned.direction.slug === "swiss-editorial");

  const css = specCss(first);
  check("spec emits oklch tokens", css.includes("oklch(") && css.includes("--accent:"));
  check("spec emits a type scale", css.includes("--step-0:") && css.includes("--font-display:"));
  check(
    "type scale is ordered",
    first.scale.length > 3 && first.scale[0] > first.scale[first.scale.length - 1]
  );
}

/* ------------------------------------------------------------------ */
/* 4. The brief says the things that matter                            */
/* ------------------------------------------------------------------ */

{
  const brief = craftBrief("chat-9:build a pricing page", {
    identifier: "pricing",
    request: "a pricing page for a letterpress studio",
    site: true,
  });
  check("brief names a direction", /Direction: .+/.test(brief));
  check("brief carries tokens", brief.includes("oklch("));
  check("brief bans the violet gradient", brief.includes("#667eea"));
  check("brief bans the Segoe stack", brief.includes("Segoe UI"));
  check("brief bans lorem ipsum", brief.toLowerCase().includes("lorem ipsum"));
  check("brief demands real content", brief.includes("Real content only"));
  check("brief demands accessibility", brief.includes("focus-visible"));
  check("brief mentions the multi-page deliverable", brief.includes("multi-page website"));

  const single = craftBrief("chat-9:build a chart", { identifier: "chart", request: "a chart" });
  check("single-file brief omits the site wording", !single.includes("multi-page website"));

  const format = siteFormatBrief({});
  check("site format shows the delimiter", format.includes('<site-file path="index.html">'));
  check("site format requires index.html", format.includes("`index.html` is required"));
}

/* ------------------------------------------------------------------ */
/* 5. Design intent classification                                     */
/* ------------------------------------------------------------------ */

{
  check(
    "build request detected",
    detectDesignIntent("build me a landing page for my bakery").craft
  );
  check(
    "multi-page request detected as a site",
    detectDesignIntent("make me a website with home, about and contact pages").site
  );
  check("single artifact not a site", !detectDesignIntent("make me an svg logo").site);
  check(
    "ordinary question is not design work",
    !detectDesignIntent("what is the capital of France?").craft
  );
  check(
    "slop complaint is a revision",
    detectDesignIntent("this looks like generic AI slop, redo it").revision
  );
  check("explicit on wins", detectDesignIntent("what is 2 + 2", true).craft);
  check("explicit off wins", !detectDesignIntent("build me a website", false).craft);
}

/* ------------------------------------------------------------------ */
/* 6. Site bundles                                                     */
/* ------------------------------------------------------------------ */

{
  const raw = `<site-file path="index.html">
<!doctype html><html lang="en"><head><link rel="stylesheet" href="styles.css"></head>
<body><h1>Home</h1><a href="about.html">About</a><script src="app.js"></script></body></html>
</site-file>
<site-file path="styles.css">
body { color: red; }
</site-file>
<site-file path="about.html">
<!doctype html><html lang="en"><body><h1>About</h1></body></html>
</site-file>
<site-file path="app.js">
console.log("hi");
</site-file>`;

  const bundle = parseSiteBundle(raw);
  check("bundle parses every file", bundle.files.length === 4, String(bundle.files.length));
  check("entry is index.html", bundle.entry === "index.html");
  check("bundle measures bytes", bundle.bytes > 0);

  const summary = summarizeSite(bundle);
  check("summary finds both pages", summary.pages.length === 2, summary.pages.join(", "));
  check("summary finds the stylesheet", summary.stylesheets.includes("styles.css"));
  check("summary finds the script", summary.scripts.includes("app.js"));

  check("root resolves to the entry", findSiteFile(bundle, "")?.path === "index.html");
  check("explicit page resolves", findSiteFile(bundle, "about.html")?.path === "about.html");
  check("extensionless page resolves", findSiteFile(bundle, "about")?.path === "about.html");
  check("missing file is null", findSiteFile(bundle, "nope.css") === null);
  check("traversal is refused", findSiteFile(bundle, "../../etc/passwd") === null);
  check("absolute path is refused", normalizeSitePath("/etc/passwd") === null);
  check("windows path is refused", normalizeSitePath("C:\\\\secrets") === null);
  check("traversal normalises to null", normalizeSitePath("../x") === null);
  check("nested path survives", normalizeSitePath("./blog/../css/main.css") === "css/main.css");

  const inlined = inlineSite(bundle);
  check(
    "inliner folds in the stylesheet",
    inlined.includes("body { color: red; }") && !inlined.includes('href="styles.css"')
  );
  check(
    "inliner folds in the script",
    inlined.includes('console.log("hi")') && !inlined.includes('src="app.js"')
  );

  const round = parseSiteBundle(serializeSiteBundle(bundle));
  check(
    "serialize round-trips",
    round.files.length === bundle.files.length && round.entry === bundle.entry
  );

  const single = parseSiteBundle("<h1>Just markup</h1>");
  check(
    "single-file bundle becomes index.html",
    single.files.length === 1 && single.entry === "index.html"
  );

  const fenced = parseSiteBundle(
    '<site-file path="a.css">\n```css\nb { color: red }\n```\n</site-file>'
  );
  check(
    "stray markdown fence is stripped",
    fenced.files[0].content === "b { color: red }",
    fenced.files[0].content
  );
}

/* ------------------------------------------------------------------ */
/* 7. The detector does not fire on an empty or trivial input          */
/* ------------------------------------------------------------------ */

{
  check("empty review is clean", reviewCraft([]).score === 100);
  check(
    "empty review has no findings",
    reviewCraft([{ path: "a.html", content: "   " }]).findings.length === 0
  );
}

console.log(`\n${passed === total ? "PASS" : "FAIL"} ${passed}/${total}`);
if (passed !== total) process.exit(1);
