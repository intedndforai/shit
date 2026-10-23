import type { Metadata } from "next";
import { CodeWorkspace } from "@/components/workspace/code-workspace";

export const metadata: Metadata = { title: "Code" };

/**
 * The code workspace is a full-height tool rather than a scrolling page: a file
 * tree, an editor and a live preview all need the viewport to themselves.
 */
export default function CodePage() {
  return <CodeWorkspace />;
}
