/**
 * Does this turn want something built?
 *
 * The full craft brief is ~120 lines. Sending it on every turn would waste
 * context on "what is the capital of France" and dilute the instruction on the
 * turns that matter. This classifier decides when to pay for it, and errs
 * towards including it: it is much worse to design with no brief than to carry
 * one the model does not need.
 *
 * An explicit toggle in the composer always wins over the guess.
 */

const BUILD_VERBS = [
  "build",
  "create",
  "make",
  "design",
  "develop",
  "code",
  "generate",
  "prototype",
  "redesign",
  "restyle",
  "revamp",
  "wireframe",
  "implement",
  "draft",
];

const BUILD_ARTIFACTS = [
  "website",
  "web site",
  "webpage",
  "web page",
  "landing page",
  "homepage",
  "home page",
  "site",
  "app",
  "webapp",
  "web app",
  "dashboard",
  "interface",
  "ui",
  "ux",
  "component",
  "page",
  "portfolio",
  "pricing page",
  "docs page",
  "blog",
  "form",
  "template",
  "theme",
  "layout",
  "mockup",
  "menu",
  "invoice",
  "resume",
  "cv",
  "poster",
  "chart",
  "diagram",
  "html",
  "css",
  "javascript",
  "react",
  "svg",
  "markdown document",
];

const CRAFT_TOPICS = [
  "typography",
  "font",
  "color palette",
  "colour palette",
  "colour scheme",
  "color scheme",
  "grid",
  "spacing",
  "art direction",
  "design system",
  "responsive",
  "hero section",
  "navbar",
  "footer",
  "card",
  "light mode",
  "dark mode",
];

/** Words that signal the user wants the look improved rather than something new. */
const REVISION_HINTS = [
  "slop",
  "generic",
  "boring",
  "looks like",
  "improve the design",
  "more original",
  "less ai",
];

export interface DesignIntent {
  /** Whether to attach the full craft brief. */
  craft: boolean;
  /** Whether the deliverable is likely more than one file. */
  site: boolean;
  /** Whether this looks like a revision of existing work. */
  revision: boolean;
}

function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

/**
 * Classify the latest user turn. `explicit` comes from the composer toggle and
 * short-circuits the heuristic when set.
 */
export function detectDesignIntent(text: string, explicit?: boolean): DesignIntent {
  const haystack = (text ?? "").toLowerCase();
  const revision = containsAny(haystack, REVISION_HINTS);

  if (explicit === true)
    return {
      craft: true,
      site: /site|website|web page|webpage|multi-?page/.test(haystack),
      revision,
    };
  if (explicit === false) return { craft: false, site: false, revision };

  if (!haystack.trim()) return { craft: false, site: false, revision: false };

  const hasVerb = containsAny(haystack, BUILD_VERBS);
  const hasArtifact = containsAny(haystack, BUILD_ARTIFACTS);
  const hasTopic = containsAny(haystack, CRAFT_TOPICS);

  // A revision request is always design work, even if the wording is terse.
  if (revision)
    return { craft: true, site: /site|website|multi-?page|pages/.test(haystack), revision: true };

  const craft = (hasVerb && hasArtifact) || (hasArtifact && hasTopic) || hasTopic;
  if (!craft) return { craft: false, site: false, revision: false };

  const site =
    /multi-?page|website|web site|pages\b|blog|docs site|documentation site|portfolio site/.test(
      haystack
    ) || /\b(?:home|landing|about|contact|pricing|blog)(?:,|\s+and\s+|\s+page)/.test(haystack);

  return { craft: true, site, revision: false };
}

export { BUILD_ARTIFACTS, BUILD_VERBS };
