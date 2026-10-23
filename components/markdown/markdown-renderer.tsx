"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Check, ChevronDown, Copy } from "lucide-react";
import { CodeBlock } from "@/components/markdown/code-block";
import { MermaidDiagram } from "@/components/markdown/mermaid-diagram";
import { RemoteImage } from "@/components/markdown/remote-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Assistant markdown renderer: GFM (tables, task lists), LaTeX via KaTeX,
 * highlighted code with a copy + wrap toolbar, and Mermaid diagrams.
 *
 * Output is sanitized with rehype-sanitize before it reaches the DOM; the
 * allowlist is extended just enough to keep highlight.js class names.
 */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "id"],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
    div: [...(defaultSchema.attributes?.div ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
    input: [...(defaultSchema.attributes?.input ?? []), "type", "checked", "disabled"],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "title", "width", "height"],
  },
  protocols: {
    ...defaultSchema.protocols,
    // `data:` in `src` is safe here: after sanitising, only img/video/audio can
    // carry `src` (no iframe, object, embed or script), and SVG in <img> cannot
    // execute script.
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
};

export const markdownSanitizeSchema = schema;

const COLLAPSE_THRESHOLD = 2400;

function nodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement(node)) {
    return nodeText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/**
 * One CSV field: doubled quotes, and quoting only when the value would
 * otherwise break the row (comma, quote, or newline).
 */
function csvField(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serialize the rendered table as CSV. Rows are found by tag, not by cell
 * component identity, so the helper keeps working whatever `th`/`td` render.
 */
function tableToCsv(children: React.ReactNode): string {
  const rows: string[] = [];

  const walk = (node: React.ReactNode) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!React.isValidElement(node)) return;

    const { children: nodeChildren } = node.props as { children?: React.ReactNode };

    if (node.type === "tr") {
      const cells = React.Children.toArray(nodeChildren).filter(React.isValidElement);
      if (cells.length > 0) {
        rows.push(cells.map((cell) => csvField(nodeText(cell))).join(","));
        return;
      }
    }

    walk(nodeChildren);
  };

  walk(children);
  return rows.join("\n");
}

/** CSS-valid subset of the HTML align values; "char" has no CSS equivalent. */
const TABLE_ALIGNMENTS = ["left", "center", "right", "justify"] as const;
type TableAlignment = (typeof TABLE_ALIGNMENTS)[number];

/**
 * Column alignment for a cell: remark-gfm puts it on `align` (from |---:|),
 * while some pipelines fold it into `style.textAlign`; both are honoured.
 */
function resolveTableCellAlign(
  align: string | undefined,
  style: React.CSSProperties | undefined
): TableAlignment | undefined {
  const raw = align ?? style?.textAlign;
  return TABLE_ALIGNMENTS.find((value) => value === raw);
}

/** Table header cell; alignment comes from the markdown column syntax. */
function TableHeadCell({
  children,
  style,
  align,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  const textAlign = resolveTableCellAlign(align, style);
  return (
    <th
      {...rest}
      style={{ ...style, textAlign }}
      className="border-b border-border px-2 py-1.5 font-medium"
    >
      {children}
    </th>
  );
}

/** Table body cell; same `align` handling as the header. */
function TableCell({
  children,
  style,
  align,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  const textAlign = resolveTableCellAlign(align, style);
  return (
    <td
      {...rest}
      style={{ ...style, textAlign }}
      className="border-b border-border/60 px-2 py-1.5 align-top"
    >
      {children}
    </td>
  );
}

function MarkdownTable({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tableToCsv(children));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="group/table relative my-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy table as CSV"
        className="absolute right-1 top-1 bg-card/80 opacity-0 backdrop-blur transition-opacity group-hover/table:opacity-100 focus-visible:opacity-100"
        onClick={copy}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Heading with a hover-only `#` anchor linking to its own slug. */
function HeadingWithAnchor({
  level,
  children,
}: {
  level: 2 | 3;
  children?: React.ReactNode;
}) {
  const slug = slugifyHeading(nodeText(children));
  const Tag = level === 2 ? "h2" : "h3";

  return (
    <Tag id={slug || undefined} className="group/heading scroll-mt-20">
      {children}
      {slug ? (
        <a
          href={`#${slug}`}
          aria-label="Link to this section"
          className="ml-1.5 select-none font-normal text-muted-foreground no-underline opacity-0 transition-opacity group-hover/heading:opacity-100 focus-visible:opacity-100"
        >
          #
        </a>
      ) : null}
    </Tag>
  );
}

function MarkdownRendererComponent({
  content,
  className,
  streaming = false,
}: {
  content: string;
  className?: string;
  /** True while tokens are still arriving for this message. */
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  // Capping a half-written answer at 420px fights the auto-scroll, so the
  // "Show full answer" treatment waits until the message is complete.
  const collapsible = !streaming && content.length > COLLAPSE_THRESHOLD;

  const components = React.useMemo<Components>(() => {
    return {
      pre({ children }) {
        const child = Array.isArray(children) ? children[0] : children;

        if (React.isValidElement(child)) {
          const props = child.props as { className?: string; children?: React.ReactNode };
          const language = /language-([\w-]+)/.exec(props.className ?? "")?.[1];
          const code = nodeText(props.children).replace(/\n$/, "");

          if (language === "mermaid") {
            return <MermaidDiagram chart={code} />;
          }

          // rehype-highlight has already tokenized this code into React
          // elements carrying `hljs-*` classes; hand them straight to CodeBlock
          // so the stylesheet sees them (there is no raw HTML to inject here).
          return <CodeBlock language={language} code={code} highlighted={props.children} />;
        }

        return <pre>{children}</pre>;
      },
      a({ href, children }) {
        // In-page anchors (the heading links) must not open a new tab.
        if (href?.startsWith("#")) {
          return (
            <a href={href} className="text-accent underline underline-offset-2">
              {children}
            </a>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline underline-offset-2"
          >
            {children}
          </a>
        );
      },
      h2({ children }) {
        return <HeadingWithAnchor level={2}>{children}</HeadingWithAnchor>;
      },
      h3({ children }) {
        return <HeadingWithAnchor level={3}>{children}</HeadingWithAnchor>;
      },
      table({ children }) {
        return <MarkdownTable>{children}</MarkdownTable>;
      },
      th({ children, style, align }) {
        return (
          <TableHeadCell style={style} align={align}>
            {children}
          </TableHeadCell>
        );
      },
      td({ children, style, align }) {
        return (
          <TableCell style={style} align={align}>
            {children}
          </TableCell>
        );
      },
      img({ src, alt }) {
        return (
          <RemoteImage
            src={typeof src === "string" ? src : undefined}
            alt={typeof alt === "string" ? alt : undefined}
          />
        );
      },
      input({ checked, type }) {
        if (type !== "checkbox") return null;
        return (
          <input
            type="checkbox"
            checked={Boolean(checked)}
            readOnly
            className="mr-1.5 size-3.5 align-middle accent-[var(--accent)]"
          />
        );
      },
    };
  }, []);

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "prose-conduit",
          collapsible && !expanded && "max-h-[420px] overflow-hidden"
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          // Highlighting re-tokenizes the whole answer, which costs more than it
          // shows while tokens are still arriving; it lands on the last frame.
          rehypePlugins={
            streaming
              ? [rehypeKatex, [rehypeSanitize, schema]]
              : [
                  rehypeKatex,
                  [rehypeHighlight, { ignoreMissing: true, detect: false }],
                  [rehypeSanitize, schema],
                ]
          }
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>

      {collapsible && !expanded ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-24 items-end justify-center bg-gradient-to-t from-background to-transparent">
          <Button
            variant="outline"
            size="sm"
            className="pointer-events-auto mb-1"
            onClick={() => setExpanded(true)}
          >
            <ChevronDown className="size-3.5" />
            Show full answer
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Memoized: identical markdown (every completed message) is never re-parsed. */
export const MarkdownRenderer = React.memo(MarkdownRendererComponent);