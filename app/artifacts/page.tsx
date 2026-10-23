import type { Metadata } from "next";
import { PageShell } from "@/components/layout/page-shell";
import { ArtifactGallery } from "@/components/artifacts/artifact-gallery";

export const metadata: Metadata = { title: "Artifacts" };

export default function ArtifactsPage() {
  return (
    <PageShell
      title="Artifacts"
      description="Self-contained HTML, multi-file sites, SVG, Mermaid, Markdown, and code blocks captured from your chats."
    >
      <ArtifactGallery />
    </PageShell>
  );
}