"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { ChevronDown } from "lucide-react";
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
  },
};

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

          // rehype-highlight already produced <code class="hljs ..."> markup.
          const inner = child as React.ReactElement<{ dangerouslySetInnerHTML?: { __html: string } }>;
          const html = inner.props?.dangerouslySetInnerHTML?.__html;

          return <CodeBlock language={language} code={code} html={html} />;
        }

        return <pre>{children}</pre>;
      },
      a({ href, children }) {
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
      table({ children }) {
        return (
          <div className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        );
      },
      th({ children }) {
        return <th className="border-b border-border px-2 py-1.5 text-left font-medium">{children}</th>;
      },
      td({ children }) {
        return <td className="border-b border-border/60 px-2 py-1.5 align-top">{children}</td>;
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
