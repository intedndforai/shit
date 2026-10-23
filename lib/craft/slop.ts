/**
 * Slop detection.
 *
 * A brief in the system prompt steers the model; this module checks whether it
 * actually listened. Every rule here is a documented tell of unedited LLM web
 * output — the violet hero gradient, the three emoji feature cards, "Get
 * Started", `transform: translateY(-5px)` on hover, Tailwind from a CDN,
 * `'Segoe UI', Tahoma, Geneva, Verdana` — plus the craft and accessibility
 * basics that generated pages almost always skip.
 *
 * The output is advisory and specific: each finding names the pattern, says why
 * it matters, and gives a concrete replacement, so it can be fed straight back
 * to the model as a revision brief.
 */

export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  id: string;
  severity: Severity;
  /** Short label for the UI. */
  title: string;
  /** Why this reads as machine-generated. */
  why: string;
  /** What to do instead. */
  fix: string;
  /** Where it was seen: "file:line" entries, capped. */
  at: string[];
  /** How many times it matched across the bundle. */
  count: number;
}

export interface CraftReview {
  /** 0-100. 100 means nothing was flagged. */
  score: number;
  grade: "exceptional" | "solid" | "generic" | "slop";
  findings: Finding[];
  /** One-line verdict for the UI. */
  summary: string;
  /** A revision brief, ready to send back to the model. */
  brief: string;
}

interface ReviewFile {
  path: string;
  content: string;
}

interface PatternRule {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  pattern: RegExp;
  /** Only test files whose path matches. */
  appliesTo?: RegExp;
  /** Minimum hits before it counts. */
  threshold?: number;
}

/* ------------------------------------------------------------------ */
/* The tells                                                           */
/* ------------------------------------------------------------------ */

const RULES: readonly PatternRule[] = [
  {
    id: "violet-gradient",
    severity: "critical",
    title: "The default violet gradient",
    why: "`#667eea → #764ba2` (and its indigo/violet cousins) is the single most recognisable signature of unedited AI output. It appears in millions of generated pages.",
    fix: "Delete the gradient. Use one flat colour from a hue you chose deliberately, and if you need depth, change surface lightness instead.",
    pattern:
      /#667eea|#764ba2|#6b73ff|#000dff|#f093fb|#4facfe|#a855f7|#8b5cf6|#6366f1|#7c3aed|#5b21b6|rgb\(\s*102\s*,\s*126\s*,\s*234\s*\)|rgb\(\s*118\s*,\s*75\s*,\s*162\s*\)|linear-gradient\([^)]{0,200}#(?:667|764|8b5|636|a85)/gi,
  },
  {
    id: "ai-font-stack",
    severity: "critical",
    title: "The giveaway font stack",
    why: "`'Segoe UI', Tahoma, Geneva, Verdana, sans-serif` is boilerplate emitted by language models and by almost nobody else. Bare `Arial, sans-serif` reads as unstyled.",
    fix: "Choose a stack with intent — a grotesque, an old-style serif, a geometric sans or a monospace — and pair display and body deliberately.",
    pattern:
      /font-family:\s*['"]?Segoe UI['"]?\s*,\s*Tahoma\s*,\s*Geneva\s*,\s*Verdana|font-family:\s*Arial\s*,\s*sans-serif\s*;|font-family:\s*['"]?Helvetica['"]?\s*,\s*Arial\s*,\s*sans-serif\s*;/gi,
  },
  {
    id: "cdn-dependency",
    severity: "critical",
    title: "Remote CDN dependency",
    why: "Tailwind's CDN build, Font Awesome, Bootstrap and Google Fonts are the standard crutches. They also break in a sandboxed preview and in any offline context.",
    fix: "Write the CSS yourself against your own tokens. For icons, inline a small set of SVGs. For type, use a system font stack.",
    pattern:
      /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|stackpath\.bootstrapcdn|maxcdn\.bootstrapcdn|use\.fontawesome\.com|kit\.fontawesome\.com/gi,
  },
  {
    id: "placeholder-images",
    severity: "high",
    title: "Placeholder image service",
    why: "`placeholder.com`, `picsum.photos` and `source.unsplash.com/random` mark a page as a stub nobody finished.",
    fix: "Draw real inline SVG, use a CSS-generated shape or pattern, or build the figure from type and colour. Never hotlink a random photo.",
    pattern:
      /via\.placeholder\.com|placeholder\.com\/|placehold\.it|picsum\.photos|source\.unsplash\.com|loremflickr|dummyimage\.com|placekitten/gi,
  },
  {
    id: "lorem-ipsum",
    severity: "critical",
    title: "Lorem ipsum",
    why: "Filler Latin means the content was never considered. Real copy changes the layout it sits in.",
    fix: "Write actual copy for the actual subject. If the subject is unknown, write plausible specific copy — names, numbers, dates — not filler.",
    pattern: /lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipiscing|sed\s+do\s+eiusmod/gi,
  },
  {
    id: "marketing-cliche",
    severity: "high",
    title: "Generic marketing copy",
    why: '"Unlock the power of", "Take it to the next level", "cutting-edge", "seamlessly", "revolutionary", "game-changing" are filler phrases that survive only because nobody read them.',
    fix: "Replace every claim with something concrete and falsifiable: what it does, for whom, with a real number or a real constraint.",
    pattern:
      /unlock the (?:power|potential)|take (?:your|it) [\w\s]{0,20}to the next level|cutting[- ]edge|state[- ]of[- ]the[- ]art|game[- ]chang(?:er|ing)|revolutioniz\w+|seamlessly integrat\w+|elevate your|supercharge your|transform the way|empower(?:ing)? (?:your|businesses|teams)|best[- ]in[- ]class|world[- ]class solution|one[- ]stop shop|harness the power/gi,
  },
  {
    id: "welcome-to-our",
    severity: "high",
    title: '"Welcome to our website"',
    why: "A heading that says nothing. The first line of a page is the most valuable space on it.",
    fix: "Lead with the specific claim or the thing itself. Name what this is and why it exists in one concrete sentence.",
    pattern:
      /welcome to (?:our|my) (?:website|site|page|app|platform)|your one[- ]stop|we are (?:a|an) (?:leading|premier|innovative)/gi,
  },
  {
    id: "generic-cta",
    severity: "medium",
    title: "Default call-to-action labels",
    why: '"Get Started" and "Learn More" are the defaults every generated page lands on, and they tell the reader nothing about what happens next.',
    fix: 'Name the action and its outcome: "Read the 2-minute setup", "See the pricing table", "Download the spec (PDF, 240 kB)".',
    // Separators inside a label accept a real space, `&nbsp;` and `&#160;`
    // (with optional zero padding). Each is a bounded alternative, so the match
    // stays linear and still only spans one label's worth of characters.
    pattern:
      />\s*(?:Get(?:&nbsp;|&#0*160;|\s)Started|Learn(?:&nbsp;|&#0*160;|\s)More|Read(?:&nbsp;|&#0*160;|\s)More|Sign(?:&nbsp;|&#0*160;|\s)Up(?:&nbsp;|&#0*160;|\s)Now|Get(?:&nbsp;|&#0*160;|\s)Started(?:&nbsp;|&#0*160;|\s)Today|Discover(?:&nbsp;|&#0*160;|\s)More|Explore(?:&nbsp;|&#0*160;|\s)Now)\s*</gi,
    threshold: 2,
  },
  {
    id: "emoji-feature-icons",
    severity: "high",
    title: "Emoji used as iconography",
    why: "🚀 ✨ 💡 🎯 🔥 as feature-card icons is a hallmark of generated marketing pages. Emoji render inconsistently and read as a placeholder for real design.",
    fix: "Use inline SVG with a consistent stroke width and grid, or drop icons entirely and let the type carry the hierarchy.",
    pattern:
      /[\u{1F680}\u{2728}\u{1F4A1}\u{1F3AF}\u{1F525}\u{1F4AA}\u{1F31F}\u{26A1}\u{1F389}\u{1F4C8}\u{1F512}\u{1F91D}\u{1F4BC}\u{1F3A8}\u{1F527}\u{2705}]/gu,
    threshold: 3,
  },
  {
    id: "default-card-shadow",
    severity: "medium",
    title: "The default card shadow",
    why: "`box-shadow: 0 4px 6px rgba(0,0,0,0.1)` on an 8px-radius white card is the stock component every model emits.",
    fix: "Separate surfaces with a 1px border and a lightness step. If you keep a shadow, define exactly one level and tune its spread and colour to the palette.",
    pattern:
      /box-shadow:\s*0\s+(?:2|4|5|8|10)px\s+(?:4|6|8|10|15|20|25)px\s+(?:-?\d+px\s+)?rgba\(0\s*,\s*0\s*,\s*0\s*,\s*0?\.(?:0[5-9]|1|12|15|2)\)/gi,
    threshold: 2,
  },
  {
    id: "hover-lift",
    severity: "medium",
    title: "The universal hover lift",
    why: "`transform: translateY(-5px)` with a bigger shadow on hover appears on essentially every generated card grid.",
    fix: "Pick a hover response that suits the direction: a border colour change, a background step, an underline reveal, or no hover at all on non-interactive cards.",
    pattern: /transform:\s*translateY\(\s*-(?:3|4|5|6|8|10)px\s*\)/gi,
  },
  {
    id: "glassmorphism",
    severity: "medium",
    title: "Stock glassmorphism",
    why: "`rgba(255,255,255,0.1)` plus `backdrop-filter: blur(10px)` is a trend applied by default rather than by choice, and it usually destroys text contrast.",
    fix: "Use it only if the direction calls for it and there is a real image behind it. Otherwise use an opaque surface and check contrast.",
    pattern:
      /backdrop-filter:\s*blur\((?:8|10|12|16|20)px\)|background:\s*rgba\(255\s*,\s*255\s*,\s*255\s*,\s*0?\.(?:0[5-9]|1|15|2)\)/gi,
    threshold: 2,
  },
  {
    id: "centered-everything",
    severity: "medium",
    title: "Everything centred",
    why: "`text-align: center` applied broadly, with a 100vh flex-centred hero, is the default composition. Centred text is harder to read and flattens hierarchy.",
    fix: "Set body copy flush left. Centre only short display lines, and only when the direction wants symmetry. Place elements on a grid position instead.",
    pattern: /text-align:\s*center/gi,
    threshold: 4,
  },
  {
    id: "vh-hero",
    severity: "low",
    title: "Full-viewport centred hero",
    why: "`min-height: 100vh` with `justify-content: center` is the stock opening screen and wastes the most valuable space on the page.",
    fix: "Let the content decide the height. Put something real above the fold — the actual interface, data, or the first paragraph.",
    pattern: /min-height:\s*100vh/gi,
  },
  {
    id: "stock-container",
    severity: "low",
    title: "The 1200px container",
    why: "`max-width: 1200px; margin: 0 auto` is the reflex container width, unrelated to the measure the type actually needs.",
    fix: "Derive the width from the content: 60-70ch for prose, or an explicit grid for dense layouts.",
    pattern: /max-width:\s*(?:1200|1140|1170)px/gi,
  },
  {
    id: "hex-greys",
    severity: "low",
    title: "Reflex grey values",
    why: "`#333` text on `#f4f4f4` with `#fff` cards is the default palette of a page nobody art-directed.",
    fix: "Build neutrals in OKLCH from your hue anchor so greys share a temperature with the accent.",
    pattern:
      /#(?:333|444|555|666|777|888|999|aaa|bbb|ccc|ddd|eee|fff|000|333333|666666|999999|f4f4f4|f5f5f5|f8f9fa|fafafa|eeeeee|e0e0e0)\b/gi,
    threshold: 3,
  },
  {
    id: "copyright-placeholder",
    severity: "high",
    title: "Placeholder footer",
    why: '"© 2024 Company Name. All rights reserved." is an unfinished footer with a hardcoded year.',
    fix: "Use the real name, and either omit the year or compute it. Put something useful in the footer: contact, source, licence, last-updated date.",
    pattern:
      /(?:©|&copy;|copyright)\s*(?:20\d\d)?\s*(?:Company Name|Your Company|Brand Name|\[Company\]|YourBrand)|All rights reserved\.?\s*<\/|Your Company Name/gi,
  },
  {
    id: "three-tier-pricing",
    severity: "medium",
    title: "Basic / Pro / Enterprise",
    why: 'The three-tier pricing table with a "Most Popular" badge on the middle column is a template, not a decision.',
    fix: "Only include pricing if the brief needs it, and then use real tiers with real numbers and a stated difference between them.",
    pattern: /\b(?:Basic|Starter)\b[\s\S]{0,400}\bPro(?:fessional)?\b[\s\S]{0,400}\bEnterprise\b/gi,
  },
  {
    id: "fake-social-proof",
    severity: "high",
    title: "Invented social proof",
    why: '"Trusted by 10,000+ companies" and five-star testimonials from "Sarah J., CEO" are fabricated claims.',
    fix: "Remove them. If the brief supplies real figures or quotes, use those verbatim; otherwise say nothing.",
    pattern:
      /trusted by\s*[\d,.]+\+?\s*(?:companies|teams|users|customers)|join\s*[\d,.]+\+?\s*(?:happy\s*)?(?:users|customers)|[\d,.]+\+?\s*(?:happy\s*)?customers|loved by\s*[\d,.]+/gi,
  },
  {
    id: "fontawesome-markup",
    severity: "medium",
    title: "Font Awesome class names",
    why: '`<i class="fas fa-rocket">` requires a CDN that will not load, leaving empty boxes.',
    fix: "Inline the SVG you need. A page rarely needs more than four icons.",
    pattern: /class="(?:fas|far|fab|fa)\s+fa-[\w-]+|<i\s+class="fa[sbr]?\s/gi,
  },
  {
    id: "alert-usage",
    severity: "medium",
    title: "`alert()` as the interaction",
    why: "A form that ends in `alert('Thanks for subscribing!')` is a demo stub, and alerts are blocked in sandboxed previews.",
    fix: "Render the result in the page: an inline status message with a live region, or a real state change.",
    pattern: /\balert\s*\(\s*['"`]/g,
  },
  {
    id: "scroll-reveal-boilerplate",
    severity: "low",
    title: "Stock scroll-reveal",
    why: "A generic IntersectionObserver that fades every section in on scroll is applied by habit and slows down reading.",
    fix: "Animate only what benefits from it, and always wrap motion in `prefers-reduced-motion: no-preference`.",
    pattern: /new IntersectionObserver\([\s\S]{0,200}(?:fade|reveal|visible|animate)/gi,
  },
  {
    id: "section-comment-scaffold",
    severity: "low",
    title: "Template section comments",
    why: "`/* Hero Section */`, `/* Features Section */`, `/* Reset */` in sequence show a template being filled rather than a page being designed.",
    fix: "Comment the non-obvious decisions instead — why a value is what it is. Delete labels that just restate the selector.",
    pattern:
      /\/\*\s*(?:Hero|Features?|Testimonials?|CTA|Footer|Navbar|Navigation|Reset|Global)\s*(?:Section|Styles)?\s*\*\//gi,
    threshold: 3,
  },
];

/* ------------------------------------------------------------------ */
/* Structural and accessibility checks                                 */
/* ------------------------------------------------------------------ */

interface StructuralFinding {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  at: string[];
}

function structuralChecks(files: readonly ReviewFile[]): StructuralFinding[] {
  const findings: StructuralFinding[] = [];
  const htmlFiles = files.filter(
    (file) => /\.html?$/i.test(file.path) || /^\s*<!doctype html/i.test(file.content)
  );
  const allCss = files
    .filter((file) => /\.css$/i.test(file.path))
    .map((file) => file.content)
    .join("\n");
  const inlineCss = htmlFiles
    .flatMap((file) =>
      [...file.content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1])
    )
    .join("\n");
  const css = `${allCss}\n${inlineCss}`;

  for (const file of htmlFiles) {
    const html = file.content;

    if (/<html(?![^>]*\blang=)/i.test(html)) {
      findings.push({
        id: "missing-lang",
        severity: "medium",
        title: "`<html>` has no `lang`",
        why: "Screen readers pick the wrong pronunciation rules, and it is a one-attribute fix that generated pages still miss.",
        fix: 'Add `lang="en"` (or the real language) to the `<html>` element.',
        at: [file.path],
      });
    }
    if (!/<meta[^>]+name=["']viewport["']/i.test(html) && /<head/i.test(html)) {
      findings.push({
        id: "missing-viewport",
        severity: "high",
        title: "No viewport meta",
        why: "Without it the page renders at desktop width on phones and the reader has to pinch-zoom.",
        fix: 'Add `<meta name="viewport" content="width=device-width, initial-scale=1">`.',
        at: [file.path],
      });
    }
    // `<title></title>` must count as missing: testing for a non-space
    // character after the tag would match the closing tag's own `<`.
    const titleBody = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (/<head/i.test(html) && (!titleBody || !titleBody[1].trim())) {
      findings.push({
        id: "missing-title",
        severity: "medium",
        title: "Empty or missing `<title>`",
        why: "The title is the tab label, the bookmark name and the first thing a search result shows.",
        fix: "Write a specific title — the subject first, the site name second.",
        at: [file.path],
      });
    }

    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
    const missingAlt = images.filter((tag) => !/\balt\s*=/i.test(tag));
    if (missingAlt.length) {
      findings.push({
        id: "missing-alt",
        severity: "high",
        title: `${missingAlt.length} image${missingAlt.length === 1 ? "" : "s"} without \`alt\``,
        why: "An image with no alt text is invisible to screen readers and shows nothing when it fails to load.",
        fix: 'Describe the content for meaningful images; use `alt=""` for purely decorative ones.',
        at: [file.path],
      });
    }

    const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
    if (headings.length) {
      const h1Count = headings.filter((level) => level === 1).length;
      if (h1Count === 0) {
        findings.push({
          id: "no-h1",
          severity: "medium",
          title: "No `<h1>`",
          why: "The document has no top-level heading, so its outline starts mid-hierarchy.",
          fix: "Give the page exactly one `<h1>` naming what it is.",
          at: [file.path],
        });
      } else if (h1Count > 1) {
        findings.push({
          id: "multiple-h1",
          severity: "low",
          title: `${h1Count} \`<h1>\` elements`,
          why: "Several competing top-level headings flatten the document outline.",
          fix: "Keep one `<h1>` and demote the rest to `<h2>`.",
          at: [file.path],
        });
      }
      let previous = headings[0];
      for (const level of headings.slice(1)) {
        if (level - previous > 1) {
          findings.push({
            id: "heading-skip",
            severity: "low",
            title: `Heading level jumps h${previous} to h${level}`,
            why: "Skipped levels break assistive-technology navigation.",
            fix: "Use the next level down, and style it rather than choosing the tag by size.",
            at: [file.path],
          });
          break;
        }
        previous = level;
      }
    }

    if (
      !/<(?:main|nav|header|footer|article|section|aside)\b/i.test(html) &&
      (html.match(/<div\b/gi) ?? []).length > 8
    ) {
      findings.push({
        id: "div-soup",
        severity: "medium",
        title: "No semantic landmarks",
        why: "A page built only from `<div>` gives assistive technology nothing to navigate by.",
        fix: "Use `<main>`, `<header>`, `<nav>`, `<footer>` and `<article>` where they apply.",
        at: [file.path],
      });
    }

    const buttonLikeAnchors = [...html.matchAll(/<a\b[^>]*href=["']#["'][^>]*>/gi)];
    if (buttonLikeAnchors.length >= 3) {
      findings.push({
        id: "dead-links",
        severity: "medium",
        title: `${buttonLikeAnchors.length} links to \`#\``,
        why: "Placeholder hrefs are focusable, announce as links and go nowhere.",
        fix: 'Point them at a real target, or use `<button type="button">` when the thing is an action.',
        at: [file.path],
      });
    }
  }

  if (css.trim()) {
    if (/transition|animation|@keyframes/i.test(css) && !/prefers-reduced-motion/i.test(css)) {
      findings.push({
        id: "no-reduced-motion",
        severity: "medium",
        title: "Motion without a reduced-motion guard",
        why: "Vestibular disorders make unrequested motion genuinely painful, and the media query costs three lines.",
        fix: "Wrap non-essential motion in `@media (prefers-reduced-motion: no-preference)`, or disable it in `reduce`.",
        at: ["css"],
      });
    }
    if (/:focus\s*\{[^}]*outline:\s*(?:none|0)/i.test(css) && !/:focus-visible/i.test(css)) {
      findings.push({
        id: "focus-removed",
        severity: "high",
        title: "Focus outline removed with no replacement",
        why: "`outline: none` without a `:focus-visible` style makes the page unusable by keyboard.",
        fix: "Style `:focus-visible` with a visible ring that has at least 3:1 contrast against both surfaces.",
        at: ["css"],
      });
    }
    if (
      !/:focus-visible/i.test(css) &&
      /<(?:button|a|input)/i.test(htmlFiles.map((file) => file.content).join(""))
    ) {
      findings.push({
        id: "no-focus-visible",
        severity: "medium",
        title: "No `:focus-visible` styles",
        why: "Default focus rings often disappear against a custom palette, and nothing was defined to replace them.",
        fix: "Define an explicit `:focus-visible` treatment for every interactive element.",
        at: ["css"],
      });
    }
    const hasCustomProps = /--[\w-]+\s*:/.test(css);
    if (!hasCustomProps && css.length > 600) {
      findings.push({
        id: "no-tokens",
        severity: "medium",
        title: "No design tokens",
        why: "Hardcoded colours and sizes repeated through the stylesheet mean there is no system behind the page.",
        fix: "Declare colour, spacing, radius and type-scale custom properties on `:root` and reference them everywhere.",
        at: ["css"],
      });
    }
    const colourLiterals = new Set(
      [...css.matchAll(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi)].map((match) => match[0].toLowerCase())
    );
    if (colourLiterals.size > 14) {
      findings.push({
        id: "palette-sprawl",
        severity: "medium",
        title: `${colourLiterals.size} distinct hex colours`,
        why: "A designed page needs very few colours. This many means they were chosen one at a time.",
        fix: "Reduce to a token set: background, surface, text, muted, border, one accent, plus state colours.",
        at: ["css"],
      });
    }
    // A stylesheet that positions things but has no breakpoint will break on a
    // phone. Keying off layout signals rather than raw length keeps this from
    // firing on a small decorative artifact that has no layout to adapt.
    const hasLayout =
      /display:\s*(?:grid|flex)|grid-template|max-width|\bwidth:\s*\d|position:\s*(?:absolute|fixed)/i.test(
        css
      );
    if (!/@media/i.test(css) && hasLayout && css.length > 400) {
      findings.push({
        id: "no-responsive",
        severity: "high",
        title: "No media queries",
        why: "The layout has no responsive behaviour, so it will break on a phone.",
        fix: "Add real breakpoints, or build with `grid-template-columns: repeat(auto-fit, minmax(...))` and `clamp()` so it adapts intrinsically.",
        at: ["css"],
      });
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

const WEIGHT: Record<Severity, number> = { critical: 26, high: 13, medium: 6, low: 2 };
const MAX_LOCATIONS = 6;

function locate(file: ReviewFile, index: number): string {
  const line = file.content.slice(0, index).split("\n").length;
  return `${file.path}:${line}`;
}

/**
 * Review a bundle of files for slop, craft and accessibility problems.
 * Pass a single `{ path: "index.html", content }` for one-file artifacts.
 */
export function reviewCraft(files: readonly ReviewFile[]): CraftReview {
  const usable = files.filter((file) => file.content && file.content.trim().length > 0);
  if (!usable.length) {
    return {
      score: 100,
      grade: "exceptional",
      findings: [],
      summary: "Nothing to review.",
      brief: "",
    };
  }

  const findings: Finding[] = [];

  for (const rule of RULES) {
    const at: string[] = [];
    let count = 0;
    for (const file of usable) {
      if (rule.appliesTo && !rule.appliesTo.test(file.path)) continue;
      // Each rule carries its own flags; rebuild to reset lastIndex safely.
      const pattern = new RegExp(
        rule.pattern.source,
        rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`
      );
      for (const match of file.content.matchAll(pattern)) {
        count += 1;
        if (at.length < MAX_LOCATIONS) at.push(locate(file, match.index ?? 0));
      }
    }
    if (count >= (rule.threshold ?? 1)) {
      findings.push({
        id: rule.id,
        severity: rule.severity,
        title: rule.title,
        why: rule.why,
        fix: rule.fix,
        at,
        count,
      });
    }
  }

  for (const structural of structuralChecks(usable)) {
    findings.push({ ...structural, count: 1 });
  }

  const penalty = findings.reduce((total, finding) => {
    const base = WEIGHT[finding.severity];
    // Repeat offences add a little, but one rule can never sink the score alone.
    const repeats = Math.min(finding.count - 1, 4) * (base * 0.15);
    return total + base + repeats;
  }, 0);

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort(
    (left, right) => order[left.severity] - order[right.severity] || right.count - left.count
  );

  const grade: CraftReview["grade"] =
    score >= 90 ? "exceptional" : score >= 72 ? "solid" : score >= 45 ? "generic" : "slop";

  const criticals = findings.filter((finding) => finding.severity === "critical").length;
  const highs = findings.filter((finding) => finding.severity === "high").length;

  const summary = !findings.length
    ? "No slop patterns, craft problems or accessibility gaps found."
    : grade === "slop"
      ? `Reads as unedited AI output: ${criticals} critical and ${highs} serious issue${highs === 1 ? "" : "s"}.`
      : grade === "generic"
        ? `Competent but generic — ${findings.length} issue${findings.length === 1 ? "" : "s"} make it look templated.`
        : grade === "solid"
          ? `Solid work with ${findings.length} thing${findings.length === 1 ? "" : "s"} left to tighten.`
          : `Strong. ${findings.length} minor note${findings.length === 1 ? "" : "s"}.`;

  return { score, grade, findings, summary, brief: revisionBrief(findings, score) };
}

/** A revision brief the model can act on directly. */
export function revisionBrief(findings: readonly Finding[], score: number): string {
  if (!findings.length) return "";
  const actionable = findings.filter((finding) => finding.severity !== "low").slice(0, 10);
  const list = (actionable.length ? actionable : findings.slice(0, 6))
    .map((finding, index) => {
      const where = finding.at.length ? ` (${finding.at.slice(0, 3).join(", ")})` : "";
      return `${index + 1}. [${finding.severity}] ${finding.title}${finding.count > 1 ? ` ×${finding.count}` : ""}${where}\n   Problem: ${finding.why}\n   Do this: ${finding.fix}`;
    })
    .join("\n");

  return [
    `A craft review of your output scored ${score}/100. Revise it to fix the following, and republish the same artifact identifier so the change is versioned:`,
    "",
    list,
    "",
    "Keep what already works. Do not restart from a template, and do not simply swap one default for another — make a deliberate choice for each point and keep the result coherent with the direction you already set.",
  ].join("\n");
}