/**
 * Art directions.
 *
 * The reason generated websites look like generated websites is that the model
 * is never given a point of view. Left alone it converges on one house style:
 * a centred hero, a violet gradient, three feature cards with emoji, Inter at
 * 16px, 8px radius everywhere, and a "Get Started" button.
 *
 * This module is the cure. Each direction is a real, opinionated system drawn
 * from an actual design tradition, described at a level the model can execute:
 * concrete font stacks, a type scale, a layout archetype, surface rules, motion
 * rules, and the traps specific to that style. One is chosen per deliverable
 * from a stable seed, then varied (hue, scale, density, radius), so two sites
 * are never twins.
 *
 * Font stacks are deliberately system-only. The preview sandbox blocks remote
 * fonts, and more importantly "load Inter from Google" is itself the tell.
 */

import { buildPalette, paletteCss, type Harmony, type Palette } from "./palette";
import { hashSeed, pick, pickFloat, pickInt, rng } from "./seed";

export interface FontPairing {
  /** Headline stack. */
  display: string;
  /** Body-copy stack. */
  body: string;
  /** Code / numerals stack. */
  mono: string;
  note: string;
}

export interface Direction {
  slug: string;
  name: string;
  /** One line the UI can show. */
  summary: string;
  /** The tradition it draws on, so the model has a mental reference. */
  lineage: string;
  fonts: readonly FontPairing[];
  /** Ratio candidates for the modular type scale. */
  scaleRatios: readonly number[];
  /** Base body size in px. */
  baseSizes: readonly number[];
  /** Layout archetypes this direction permits. */
  layouts: readonly string[];
  /** How surfaces are separated: the shadow/border/radius philosophy. */
  surfaces: readonly string[];
  /** Motion philosophy. */
  motion: readonly string[];
  /** Radius range in px. */
  radius: readonly [number, number];
  /** Spacing unit range in px. */
  spacing: readonly [number, number];
  /** Preferred colour harmonies. */
  harmonies: readonly Harmony[];
  /** Preferred scheme, or null to let the seed decide. */
  scheme: "light" | "dark" | null;
  intensity: "quiet" | "measured" | "vivid";
  /** Non-negotiable rules that define the style. */
  rules: readonly string[];
  /** Traps specific to this direction. */
  avoid: readonly string[];
}

export const DIRECTIONS: readonly Direction[] = [
  {
    slug: "swiss-editorial",
    name: "Swiss Editorial",
    summary: "Strict grid, flush-left type, one accent, nothing decorative.",
    lineage: "International Typographic Style — Müller-Brockmann, Hofmann, Neue Grafik.",
    fonts: [
      {
        display: '"Helvetica Neue", Helvetica, "Nimbus Sans", Arial, sans-serif',
        body: '"Helvetica Neue", Helvetica, "Nimbus Sans", Arial, sans-serif',
        mono: '"SF Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
        note: "One family at several weights. Hierarchy comes from size and weight, never from a second typeface.",
      },
      {
        display: '"Inter Tight", "Helvetica Neue", Arial, sans-serif',
        body: '"Source Sans 3", "Segoe UI", system-ui, sans-serif',
        mono: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
        note: "Tight grotesque headlines over a humanist body with a taller x-height.",
      },
    ],
    scaleRatios: [1.2, 1.25, 1.333],
    baseSizes: [16, 17, 18],
    layouts: [
      "A visible 12-column grid. Content spans named column ranges (2/8, 1/5, 7/12) and deliberately never centres.",
      "Asymmetric two-column: a narrow left rail for labels and metadata, a wide right column for content.",
      "Swiss poster: one enormous headline occupying the top third, flush left, with a dense body block beneath at small size.",
    ],
    surfaces: [
      "No shadows at all. Separation is whitespace and 1px rules in the border colour.",
      "Flat colour fields. A block is defined by a background change, not by a card.",
    ],
    motion: [
      "Almost none. Opacity-only fades at 120ms. No transforms, no scroll animation.",
      "A single deliberate transition on interactive elements at 90ms linear.",
    ],
    radius: [0, 2],
    spacing: [8, 8],
    harmonies: ["monochrome", "complementary"],
    scheme: "light",
    intensity: "vivid",
    rules: [
      "Type is flush left, ragged right. Never justify, never centre body copy.",
      "Exactly one accent colour, used sparingly and with intent — a rule, a single word, one block.",
      "Headlines set tight: line-height 0.95-1.05, letter-spacing -0.02em or tighter.",
      "The baseline grid is real: every vertical measurement is a multiple of the spacing unit.",
      "Labels and metadata are set in uppercase at 11-12px with +0.08em tracking.",
    ],
    avoid: [
      "Centred hero sections.",
      "Any gradient, any shadow, any rounded card.",
      "Decorative icons beside headings.",
    ],
  },
  {
    slug: "brutalist-document",
    name: "Brutalist Document",
    summary: "Raw structure, visible mechanics, hairline rules, zero ornament.",
    lineage:
      "Early web documents, Bauhaus signage, the aesthetic of unstyled HTML owned on purpose.",
    fonts: [
      {
        display: '"Arial Black", "Helvetica Neue", Impact, sans-serif',
        body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: '"Courier New", Courier, monospace',
        note: "Heavy condensed display against a plain system body. The contrast is the point.",
      },
      {
        display: '"Courier New", Courier, monospace',
        body: '"Courier New", Courier, monospace',
        mono: '"Courier New", Courier, monospace',
        note: "Monospace throughout: the page reads as a printed specimen.",
      },
    ],
    scaleRatios: [1.414, 1.5, 1.618],
    baseSizes: [15, 16, 17],
    layouts: [
      "A single measured column, max-width 60-72ch, with hairline rules between every section.",
      "A table-of-contents page: numbered sections, hanging indents, rules above each heading.",
      "Full-bleed blocks of flat colour stacked with no gaps, text sitting directly on them.",
    ],
    surfaces: [
      "1px or 2px solid borders in the text colour. No radius, no shadow, no fill.",
      "Inverted blocks: text colour becomes the background and vice versa.",
    ],
    motion: ["None. Hover states change colour instantly with no transition."],
    radius: [0, 0],
    spacing: [8, 12],
    harmonies: ["monochrome", "duotone"],
    scheme: null,
    intensity: "vivid",
    rules: [
      "Borders are structural and visible. Use 1-2px solid lines, never a soft shadow.",
      "Underline real links with text-underline-offset, do not restyle them into buttons.",
      "Number the sections. Show the structure rather than smoothing it away.",
      "Set one element at an uncomfortably large size for deliberate contrast.",
      "Hover states invert colour rather than fading.",
    ],
    avoid: ["Any border-radius.", "Shadows, gradients, glassmorphism.", "Soft pastel palettes."],
  },
  {
    slug: "warm-print",
    name: "Warm Print",
    summary: "Old-style serif, paper tone, generous measure, letterpress calm.",
    lineage: "Book typography — Bringhurst, Tschichold, trade paperback interiors.",
    fonts: [
      {
        display: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
        body: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
        mono: '"Iosevka", "SF Mono", Menlo, monospace',
        note: "One old-style serif throughout, as a book would be set.",
      },
      {
        display: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
        body: '"Source Serif 4", Charter, Georgia, serif',
        mono: '"IBM Plex Mono", Menlo, monospace',
        note: "Transitional serif with a sturdy, screen-friendly body.",
      },
    ],
    scaleRatios: [1.2, 1.25],
    baseSizes: [18, 19, 20],
    layouts: [
      "A single column at 62-68ch, centred in the viewport but with text flush left inside it.",
      "Body column with a wide left margin reserved for marginalia, pull quotes and figure captions.",
      "Chaptered long-form: a display opening, drop-cap or small-caps lead-in, then even body rhythm.",
    ],
    surfaces: [
      "No cards. Sections separated by vertical rhythm and the occasional thin rule.",
      "Paper-tinted background (never pure white) with ink-toned text (never pure black).",
    ],
    motion: ["Restrained: 200ms ease-out opacity on reveal, nothing that moves the text."],
    radius: [0, 3],
    spacing: [8, 10],
    harmonies: ["monochrome", "analogous"],
    scheme: "light",
    intensity: "quiet",
    rules: [
      "Line-height 1.6-1.75 on body copy. Measure stays between 60 and 70 characters.",
      "Background is warm paper, text is warm ink. Pure #fff and #000 are forbidden.",
      "Use real typography: proper quotes, em dashes, hanging punctuation, old-style numerals where available.",
      "Paragraph spacing OR first-line indent, never both.",
      "Headings are modest — a serif page earns hierarchy from weight and space, not size.",
    ],
    avoid: ["Sans-serif body copy.", "Cards, shadows, badges.", "Bright saturated accents."],
  },
  {
    slug: "technical-terminal",
    name: "Technical Terminal",
    summary: "Monospace-led, data-dense, grid lines, status colour only.",
    lineage: "Bloomberg terminals, aircraft instrumentation, Teenage Engineering manuals.",
    fonts: [
      {
        display: '"JetBrains Mono", "SF Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
        body: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
        mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
        note: "Monospace headings and figures, compact sans for prose.",
      },
      {
        display: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
        body: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
        mono: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
        note: "Entirely monospace — everything lands on a character grid.",
      },
    ],
    scaleRatios: [1.125, 1.2],
    baseSizes: [13, 14, 15],
    layouts: [
      "Dense dashboard: a hairline-ruled grid of panels, each with a small uppercase label and a large figure.",
      "Spec sheet: definition rows of label/value pairs, hairline separated, numerals right-aligned.",
      "Split view — a fixed left index of monospace entries beside a detail pane.",
    ],
    surfaces: [
      "Hairline 1px grid lines in a low-contrast border colour. Panels share edges rather than floating.",
      "Flat panels distinguished only by a slight surface-lightness step.",
    ],
    motion: [
      "Functional only: 80-120ms linear on state change. Numerals may tick, nothing slides.",
    ],
    radius: [0, 4],
    spacing: [4, 8],
    harmonies: ["monochrome", "triad"],
    scheme: "dark",
    intensity: "vivid",
    rules: [
      "Numerals are tabular (font-variant-numeric: tabular-nums) and right-aligned in every column.",
      "Information density is the goal: tight padding, small type, no empty decorative space.",
      "Colour carries meaning only — ok / warn / error / idle. Never decorative.",
      "Labels are uppercase, 10-11px, tracked +0.1em, in the muted colour.",
      "Show units, precision and timestamps. Real instruments never hide their scale.",
    ],
    avoid: ["Large hero sections.", "Rounded friendly cards.", "Illustrations or emoji."],
  },
  {
    slug: "gallery-minimal",
    name: "Gallery Minimal",
    summary: "Vast whitespace, very small type, image-first, asymmetric placement.",
    lineage: "Exhibition catalogues, Dieter Rams, high-end fashion lookbooks.",
    fonts: [
      {
        display: '"Futura", "Century Gothic", "Avenir Next", Avenir, system-ui, sans-serif',
        body: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif',
        mono: '"SF Mono", Menlo, monospace',
        note: "Geometric sans with wide tracking on the display line.",
      },
      {
        display: '"Optima", "Segoe UI", Candara, "Gill Sans", sans-serif',
        body: '"Segoe UI", system-ui, -apple-system, sans-serif',
        mono: '"SF Mono", Menlo, monospace',
        note: "Humanist sans with calligraphic stress — quiet and expensive.",
      },
    ],
    scaleRatios: [1.333, 1.414],
    baseSizes: [14, 15, 16],
    layouts: [
      "Content occupies under half the viewport width, positioned off-centre, surrounded by air.",
      "Staggered image grid where each item sits at a different vertical offset.",
      "Single full-bleed image with one small caption block placed in a corner.",
    ],
    surfaces: ["Nothing. No borders, no shadows, no fills. Space alone separates content."],
    motion: [
      "Slow and quiet: 400-600ms cubic-bezier(0.16,1,0.3,1) opacity and small translate on reveal.",
    ],
    radius: [0, 0],
    spacing: [12, 16],
    harmonies: ["monochrome"],
    scheme: null,
    intensity: "quiet",
    rules: [
      "Whitespace is the primary material. Use 120-200px of vertical breathing room between sections.",
      "Display type is set small-to-medium with generous tracking (+0.1em to +0.3em), often uppercase.",
      "At most two colours plus one neutral. Usually just ink on paper.",
      "Alignment is deliberately asymmetric — place things on a grid position, not in the middle.",
      "Captions are tiny (11-12px) and sit close to what they describe.",
    ],
    avoid: ["Filling the viewport width.", "Multiple competing accents.", "Any card component."],
  },
  {
    slug: "neo-geometric",
    name: "Neo-Geometric",
    summary: "Bold colour blocking, hard edges, geometric sans, confident scale.",
    lineage: "Bauhaus, De Stijl, Memphis restraint, modern festival identity systems.",
    fonts: [
      {
        display: '"Futura", "Century Gothic", "Avenir Next", system-ui, sans-serif',
        body: '"Avenir Next", "Segoe UI", system-ui, sans-serif',
        mono: '"Space Mono", "SF Mono", Menlo, monospace',
        note: "Geometric sans at heavy weight for display, same family lighter for body.",
      },
      {
        display: '"Archivo Black", "Arial Black", "Helvetica Neue", sans-serif',
        body: '"Archivo", "Segoe UI", system-ui, sans-serif',
        mono: '"Space Mono", Menlo, monospace',
        note: "Grotesque black display with a neutral workhorse body.",
      },
    ],
    scaleRatios: [1.5, 1.618, 1.8],
    baseSizes: [16, 17, 18],
    layouts: [
      "Hard-edged colour blocks tiling the page; each block is a section, text sits directly on the colour.",
      "Diagonal or offset grid where blocks of different sizes interlock with no gutters.",
      "Oversized display type cropped by the viewport edge, with content blocks beneath.",
    ],
    surfaces: [
      "Flat colour fields meeting at hard edges. No shadow, no radius, no gap between blocks.",
      "Occasional thick 3-4px border as a graphic device, in the text colour.",
    ],
    motion: [
      "Snappy: 150-220ms cubic-bezier(0.2,0,0,1). Blocks may shift position; nothing fades slowly.",
    ],
    radius: [0, 4],
    spacing: [8, 12],
    harmonies: ["triad", "complementary", "duotone"],
    scheme: "light",
    intensity: "vivid",
    rules: [
      "Colour is structural: a section is a colour field, not a white card on a grey page.",
      "Use two or three saturated colours at full strength plus one near-black and one off-white.",
      "Display type is heavy and large — 1 to 1.4 times the viewport width for the lead line.",
      "Geometry is explicit: circles, squares and rules used as composition, not decoration.",
      "Edges meet. Avoid gutters between coloured blocks.",
    ],
    avoid: ["Pastel washes.", "Drop shadows and rounded cards.", "Gradient fills."],
  },
  {
    slug: "didone-luxury",
    name: "Didone Luxury",
    summary: "High-contrast serif, tight tracking, deep neutrals, hairline rules.",
    lineage: "Vogue mastheads, Bodoni and Didot specimens, luxury goods packaging.",
    fonts: [
      {
        display: 'Didot, "Bodoni MT", "Playfair Display", "Times New Roman", Georgia, serif',
        body: '"Optima", "Gill Sans", "Segoe UI", system-ui, sans-serif',
        mono: '"SF Mono", Menlo, monospace',
        note: "Didone display over a humanist sans body — the classic fashion pairing.",
      },
      {
        display: '"Bodoni MT", Didot, "Playfair Display", Garamond, serif',
        body: 'Garamond, "EB Garamond", "Palatino Linotype", Georgia, serif',
        mono: '"SF Mono", Menlo, monospace',
        note: "All-serif, high contrast display against an old-style body.",
      },
    ],
    scaleRatios: [1.414, 1.5],
    baseSizes: [15, 16, 17],
    layouts: [
      "Centred masthead with wide tracking, then an asymmetric editorial grid beneath.",
      "Full-height split: image on one half, a narrow text column vertically centred on the other.",
      "Magazine opener — large display line, thin rule, standfirst in sans at small size.",
    ],
    surfaces: [
      "Hairline 1px rules only, in a muted neutral. No shadows, no fills, no radius.",
      "Deep neutral fields (near-black, bone, oyster) with content floating in them.",
    ],
    motion: ["Slow, expensive: 500-700ms ease-out. Nothing bounces."],
    radius: [0, 2],
    spacing: [8, 12],
    harmonies: ["monochrome", "analogous"],
    scheme: null,
    intensity: "quiet",
    rules: [
      "The masthead is uppercase, widely tracked (+0.2em to +0.4em), and thin.",
      "Display serif is set large with tight line-height (0.9-1.0) to show its contrast.",
      "Palette is near-monochrome: bone, oyster, graphite, near-black, plus at most one muted metallic.",
      "Hairline rules do the dividing. 1px, muted, full width or precisely measured.",
      "Body copy is small and in sans, which makes the serif display read as the voice.",
    ],
    avoid: [
      "Saturated brand colours.",
      "Rounded buttons.",
      "Dense layouts — this style needs air.",
    ],
  },
  {
    slug: "soft-utility",
    name: "Soft Utility",
    summary: "Rounded sans, muted tones, honest product UI done properly.",
    lineage: "Scandinavian product design, Linear and Things, well-made native apps.",
    fonts: [
      {
        display: '"SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif',
        body: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
        mono: '"SF Mono", "JetBrains Mono", Menlo, monospace',
        note: "Rounded display with the native system body — feels like an app, not a landing page.",
      },
      {
        display: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
        body: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
        mono: '"Cascadia Code", "SF Mono", Consolas, monospace',
        note: "One system family across two optical sizes.",
      },
    ],
    scaleRatios: [1.2, 1.25],
    baseSizes: [14, 15, 16],
    layouts: [
      "App shell: a quiet sidebar, a content pane with a sticky header, and real empty states.",
      "Settings-style list: grouped rows with labels, descriptions, and controls right-aligned.",
      "Inbox layout — a list pane with a detail pane, keyboard hints visible.",
    ],
    surfaces: [
      "A single soft shadow level used only for genuinely floating things (menus, dialogs). Flat elsewhere.",
      "Surfaces differ by a small lightness step plus a 1px border, not by shadow.",
    ],
    motion: ["Interface-grade: 140-200ms cubic-bezier(0.2,0,0,1) on enter, 100-140ms on exit."],
    radius: [8, 14],
    spacing: [4, 8],
    harmonies: ["analogous", "monochrome"],
    scheme: null,
    intensity: "measured",
    rules: [
      "Radius is consistent and nested correctly: an inner radius equals the outer minus its padding.",
      "Exactly one shadow level exists in the whole system, and most elements do not use it.",
      "Interactive elements have real hover, active, focus-visible and disabled states.",
      "Empty states, loading states and error states are designed, not omitted.",
      "Text sizes are few: 11, 13, 15, 20, 28. Do not invent sizes between them.",
    ],
    avoid: [
      "Marketing-page clichés — this is an interface, not a hero section.",
      "Multiple shadow levels stacked for depth.",
      "Gradient buttons.",
    ],
  },
  {
    slug: "archive-index",
    name: "Archive Index",
    summary: "List-led, numbered, hairline-ruled, academic density.",
    lineage: "Library catalogues, scientific journals, Wikipedia done with taste.",
    fonts: [
      {
        display: '"Source Serif 4", Charter, Georgia, serif',
        body: '"Source Sans 3", "Segoe UI", system-ui, sans-serif',
        mono: '"IBM Plex Mono", Menlo, monospace',
        note: "Serif headings, sans body — the journal convention.",
      },
      {
        display: '"Helvetica Neue", Arial, sans-serif',
        body: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
        mono: '"IBM Plex Mono", Menlo, monospace',
        note: "Inverted: grotesque headings over a serif body.",
      },
    ],
    scaleRatios: [1.2, 1.25],
    baseSizes: [15, 16],
    layouts: [
      "A long numbered index: rows of number / title / meta, hairline separated, scannable at speed.",
      "Two-column reference layout with a sticky section nav on the left.",
      "Table-first: a real <table> with a proper <thead>, zebra-free hairline rows, right-aligned figures.",
    ],
    surfaces: ["1px hairline rules between rows. No cards, no shadows, minimal radius."],
    motion: ["None beyond a 100ms hover tint on rows."],
    radius: [0, 4],
    spacing: [4, 8],
    harmonies: ["monochrome", "analogous"],
    scheme: "light",
    intensity: "measured",
    rules: [
      "Use real semantic tables and definition lists where the content is tabular.",
      "Number things. Sequence is information.",
      "Metadata (dates, counts, categories) is visible and consistently positioned.",
      "Figures are tabular-nums and right-aligned; text is flush left.",
      "Row height is tight — this style is about seeing a lot at once.",
    ],
    avoid: ["Hero sections.", "Card grids.", "Decorative imagery."],
  },
  {
    slug: "night-lab",
    name: "Night Lab",
    summary: "Dark-first, one vivid accent, precise mono numerals, engineered calm.",
    lineage: "Developer tooling, synthesiser panels, observatory software.",
    fonts: [
      {
        display: '"Inter Tight", "Helvetica Neue", system-ui, sans-serif',
        body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
        mono: '"JetBrains Mono", "SF Mono", "IBM Plex Mono", Menlo, monospace',
        note: "Tight grotesque with a monospace that carries every number.",
      },
      {
        display: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
        body: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
        mono: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
        note: "One engineered family across sans and mono.",
      },
    ],
    scaleRatios: [1.2, 1.25, 1.333],
    baseSizes: [14, 15, 16],
    layouts: [
      "Dark canvas with content in precisely aligned panels sharing hairline edges.",
      "A command-centre layout: persistent left nav, top status strip, focused work area.",
      "Documentation shell — sticky sidebar tree, measured prose column, right-hand outline.",
    ],
    surfaces: [
      "Surfaces step up in lightness, never with shadow. Borders are a lighter neutral at 1px.",
      "The accent appears as a 2px edge or a small fill, never as a large field.",
    ],
    motion: ["Precise: 120-180ms cubic-bezier(0.2,0,0,1). Focus rings appear instantly."],
    radius: [4, 8],
    spacing: [4, 8],
    harmonies: ["monochrome", "split"],
    scheme: "dark",
    intensity: "vivid",
    rules: [
      "Dark means layered neutrals, not pure black. The canvas sits around 16-20% lightness.",
      "One accent only, reserved for the single most important action or the live value.",
      "Monospace for every number, identifier, key and measurement, with tabular figures.",
      "Contrast is checked: body text holds at least 7:1 against the canvas.",
      "Focus-visible states are explicit and high contrast — this style is used by keyboard.",
    ],
    avoid: [
      "Neon glow and heavy shadows.",
      "Multiple accents competing for attention.",
      "Pure #000 backgrounds or #fff text.",
    ],
  },
] as const;

export function directionBySlug(slug: string): Direction | null {
  return DIRECTIONS.find((direction) => direction.slug === slug) ?? null;
}

/** The fully resolved art direction for one deliverable. */
export interface CraftSpec {
  direction: Direction;
  fonts: FontPairing;
  palette: Palette;
  /** Modular scale ratio. */
  ratio: number;
  /** Base body size in px. */
  baseSize: number;
  /** The chosen layout archetype. */
  layout: string;
  surface: string;
  motion: string;
  radiusPx: number;
  spacingPx: number;
  /** The seed string this spec came from, for reproducibility. */
  seed: string;
  /** Computed type scale, largest first. */
  scale: readonly number[];
}

/**
 * Resolve a direction for a deliverable.
 *
 * `seed` should identify the deliverable (chat id + artifact identifier works
 * well): the same seed always yields the same spec, so a regenerated artifact
 * keeps its identity, while a different one gets a different look.
 */
export function resolveCraftSpec(
  seed: string,
  options: { preferred?: string | null } = {}
): CraftSpec {
  const random = rng(hashSeed(seed));
  const preferred = options.preferred ? directionBySlug(options.preferred) : null;
  const direction = preferred ?? pick(DIRECTIONS, random);
  const ratio = pick(direction.scaleRatios, random);
  const baseSize = pick(direction.baseSizes, random);

  const steps = 6;
  const scale: number[] = [];
  for (let step = steps - 1; step >= -1; step -= 1) {
    scale.push(Math.round(baseSize * ratio ** step * 100) / 100);
  }

  return {
    direction,
    fonts: pick(direction.fonts, random),
    palette: buildPalette({
      random,
      scheme: direction.scheme ?? undefined,
      harmony: pick(direction.harmonies, random),
      intensity: direction.intensity,
    }),
    ratio,
    baseSize,
    layout: pick(direction.layouts, random),
    surface: pick(direction.surfaces, random),
    motion: pick(direction.motion, random),
    radiusPx: pickInt(direction.radius[0], direction.radius[1], random),
    spacingPx: pickInt(direction.spacing[0], direction.spacing[1], random),
    seed,
    scale,
  };
}

/** A ready-to-paste CSS token block for the resolved spec. */
export function specCss(spec: CraftSpec): string {
  const scaleVars = spec.scale
    .map((size, index) => `  --step-${spec.scale.length - 2 - index}: ${size}px;`)
    .join("\n");
  return [
    paletteCss(spec.palette),
    "",
    ":root {",
    `  --font-display: ${spec.fonts.display};`,
    `  --font-body: ${spec.fonts.body};`,
    `  --font-mono: ${spec.fonts.mono};`,
    `  --radius: ${spec.radiusPx}px;`,
    `  --space: ${spec.spacingPx}px;`,
    scaleVars,
    "}",
  ].join("\n");
}

export { paletteCss };
export type { Palette, Harmony };
export { buildPalette, pickFloat };
