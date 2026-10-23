/**
 * The craft brief.
 *
 * This is the module that fixes the root cause. Previously the entire art
 * direction handed to the model was five lines that said "keep it
 * self-contained". Left at that, every model converges on the same house style.
 *
 * Here a resolved {@link CraftSpec} is turned into an executable brief: the
 * direction and its lineage, a real font pairing, OKLCH tokens, a type scale,
 * a layout archetype, surface and motion rules, the traps for that style, and a
 * hard list of banned defaults. The model is asked to commit to it before
 * writing markup.
 *
 * The brief is deterministic for a given seed, so a regenerated artifact keeps
 * its identity and version diffs stay legible.
 */

import { paletteCss, resolveCraftSpec, type CraftSpec } from "./directions";

const BANNED_DEFAULTS = [
  "the violet/indigo gradient (`#667eea → #764ba2` and every cousin) as a hero background or a button fill",
  "`font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`, or Arial/Helvetica as an unexplained default",
  "Tailwind, Bootstrap, Font Awesome or Google Fonts from a CDN — a sandboxed preview has no network, and the CDN is itself the tell",
  "`placeholder.com`, `picsum.photos`, `source.unsplash.com` or any hotlinked stock photo",
  'lorem ipsum, or headings like "Welcome to Our Website" and "Unlock the Power of …"',
  "emoji used as feature icons (🚀 ✨ 💡 🎯 🔥)",
  "`transform: translateY(-5px)` plus a bigger shadow as the universal card hover",
  "`box-shadow: 0 4px 6px rgba(0,0,0,0.1)` on a white 8px-radius card",
  'the three-tier Basic/Pro/Enterprise pricing table with a "Most Popular" middle column',
  'invented statistics or testimonials ("Trusted by 10,000+ companies")',
  '`alert()` as the end of a form, and `href="#"` as a destination',
  "`min-height: 100vh` with a centred hero as the opening screen",
] as const;

export interface CraftBriefOptions {
  /** Artifact identifier, used in the brief and as the seed with the chat id. */
  identifier: string;
  /** What the user asked for, quoted back so the direction serves the content. */
  request?: string;
  /** Pin a direction by slug instead of seeding one. */
  preferredDirection?: string | null;
  /** True when the deliverable is a multi-page site rather than one file. */
  site?: boolean;
  /** True when the brief accompanies a revision request rather than a first draft. */
  revision?: boolean;
}

/**
 * Build the brief. Deterministic for the given seed: the same identifier in the
 * same chat always resolves to the same direction.
 */
export function craftBrief(seed: string, options: CraftBriefOptions): string {
  const spec = resolveCraftSpec(seed, { preferred: options.preferredDirection ?? null });
  return renderBrief(spec, options);
}

/** The resolved spec, for callers that also want to display it. */
export function craftSpecFor(
  seed: string,
  options: CraftBriefOptions = { identifier: "" }
): CraftSpec {
  return resolveCraftSpec(seed, { preferred: options.preferredDirection ?? null });
}

function bullets(items: readonly string[]): string {
  return items.map((item) => `  - ${item}`).join("\n");
}

function renderBrief(spec: CraftSpec, options: CraftBriefOptions): string {
  const { direction, fonts, palette, scale } = spec;
  const scheme = palette.scheme === "dark" ? "dark-first" : "light-first";
  const scaleList = scale.map((size) => `${size}px`).join(" / ");

  return [
    "ART DIRECTION — commit to this before you write a single tag. This is not a suggestion; a design that ignores it will be sent back.",
    "",
    `Direction: ${direction.name} (${scheme}). ${direction.summary}`,
    `Lineage: ${direction.lineage} Work from that tradition, not from a component library.`,
    options.request ? `The subject is: ${options.request}` : "",
    options.site
      ? "Deliverable: a multi-page website. Every page must share one design system so the site feels built, not generated page by page."
      : "Deliverable: a single self-contained page.",
    "",
    "Typography",
    `  - Display: ${fonts.display}`,
    `  - Body: ${fonts.body}`,
    `  - Mono: ${fonts.mono}`,
    `  - ${fonts.note}`,
    `  - Body size ${spec.baseSize}px, modular scale ratio ${spec.ratio}: ${scaleList}.`,
    "  - Use fewer sizes, chosen from that scale. Do not invent sizes between the steps.",
    "",
    "Colour",
    `  - Harmony: ${palette.harmony}, hue anchor ${palette.hue}deg, ${spec.palette.scheme}.`,
    "  - Declare exactly these custom properties on `:root` and use them for every colour:",
    indent(paletteCss(palette), "    "),
    "  - Neutrals share the accent's hue. Do not substitute pure #000, #fff, or an unrelated grey.",
    "",
    "Layout",
    `  - Archetype: ${spec.layout}`,
    "  - Spacing unit: " + spec.spacingPx + "px. Every vertical measurement is a multiple of it.",
    "  - Use real CSS grid for structure. Intrinsic sizing (`clamp()`, `minmax()`, `auto-fit`) beats fixed breakpoints.",
    "",
    "Surfaces",
    `  - ${spec.surface}`,
    `  - Corner radius: ${spec.radiusPx}px. One radius system, applied consistently and nested correctly.`,
    "",
    "Motion",
    `  - ${spec.motion}`,
    "  - Wrap anything non-essential in `@media (prefers-reduced-motion: no-preference)`.",
    "",
    "Non-negotiable rules for this direction",
    bullets(direction.rules),
    "",
    "Traps specific to this direction",
    bullets(direction.avoid),
    "",
    "Banned defaults — these are the signatures of unedited machine output. None of them may appear:",
    bullets(BANNED_DEFAULTS),
    "",
    "Craft requirements that apply to everything",
    bullets([
      "Real content only. Specific names, numbers, dates and copy about the actual subject. No filler, no invented statistics or testimonials.",
      "Semantic HTML: `header`, `nav`, `main`, `article`, `section`, `footer`, real `button` for actions, real `a` for links, real `table` for tabular data.",
      "Accessibility is part of the design: exactly one `h1`, no skipped heading levels, `alt` on images, an explicit `:focus-visible` style, and text contrast of at least 4.5:1 (7:1 for body copy in a dark palette).",
      "Interactive states are all designed: hover, active, focus-visible, disabled, empty, loading and error.",
      "Hand-write the CSS against your own tokens. No framework, no CDN, no build step.",
      "Inline SVG with a consistent stroke width for any iconography you genuinely need — and prefer none at all.",
      "Responsive from the start and tested at 360px, 768px and 1440px. Nothing may overflow horizontally.",
    ]),
    options.revision
      ? "This replaces an earlier version. Apply the direction fully rather than patching the old design, and keep the identifier so the change is versioned."
      : "",
    "Before you publish, check your own work against every rule above. If something does not fit the direction, remove it rather than making it neutral.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function indent(block: string, prefix: string): string {
  return block
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export interface SiteFormatBriefOptions {
  /** How many pages the brief should expect, if the request implies it. */
  suggestedPages?: readonly string[];
}

/** The `<site-file>` publishing format, spelled out. */
export function siteFormatBrief(options: SiteFormatBriefOptions = {}): string {
  const pages = options.suggestedPages?.length
    ? `Suggested pages for this request: ${options.suggestedPages.join(", ")}.`
    : "Use as many pages as the request genuinely needs — usually two to four.";

  return [
    "MULTI-FILE WEBSITE OUTPUT — publish the whole site as one `site` artifact.",
    "Indent every file's contents by two spaces and give each file its real path. Format:",
    "",
    '<artifact identifier="kebab-case-slug" type="site" title="The Site Name">',
    '<site-file path="index.html">',
    "  <!doctype html> ... the full page ...",
    "</site-file>",
    '<site-file path="styles.css">',
    "  :root { ...your tokens... } ...all the CSS for every page...",
    "</site-file>",
    '<site-file path="app.js">',
    "  // progressive enhancement only; the site must work with JS disabled",
    "</site-file>",
    "</artifact>",
    "",
    "Rules for a site artifact:",
    bullets([
      "`index.html` is required and is served at the site root; link to other pages with plain relative hrefs (`about.html`, `blog/post.html`).",
      'One stylesheet shared by every page, linked with a relative `<link rel="stylesheet" href="styles.css">`. Never repeat a per-page `<style>` block for shared styles.',
      'Relative `<script src="app.js" defer>` and `type="module"` scripts both work, so real ES modules with relative imports are allowed.',
      "No absolute URLs, no CDN links, no remote fonts or images. Fonts come from your font stack; images are inline SVG or CSS-drawn.",
      'Every page carries the same header, navigation and footer markup, with the current page marked `aria-current="page"`.',
      'Navigation must actually work — no `href="#"` placeholders, no dead ends. Every page is reachable from every other page.',
      pages,
      "Pages carry real titles in `<title>` and a meta description, and share one `<html lang>`.",
      "Do not put a `<site-file>` inside another `<site-file>`. Close every tag exactly.",
      "A site the user asked for is delivered as this artifact - do not write it into the workspace folder instead; use the workspace only when the user explicitly asks to work in their folder or names a file path.",
    ]),
  ].join("\n");
}

/**
 * The single-page counterpart, used when the deliverable is an artifact the
 * model renders in place rather than a whole project.
 */
export function selfContainedBrief(options: { artifactType: string }): string {
  return [
    `SINGLE-FILE OUTPUT — publish it as a \`${options.artifactType}\` artifact:`,
    `<artifact identifier="kebab-case-slug" type="${options.artifactType}" title="Human title">…the complete file…</artifact>`,
    "Everything must be inline: styles in a `<style>` block, scripts in a `<script>` block, fonts from a system stack, images as inline SVG or data URLs.",
    'If the page would be more than roughly 400 lines, or the request implies more than one page, use a `type="site"` artifact instead — see the multi-file rules.',
  ].join("\n");
}
