import type { Metadata } from "next";
import { Blocks } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Artifacts" };

export default function ArtifactsPage() {
  return (
    <PageShell
      title="Artifacts"
      description="Every HTML, React, SVG, or Mermaid artifact your models create, with version history."
      actions={<Badge variant="warning">Milestone 5</Badge>}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Blocks className="size-4 text-accent" />
            Artifact library
          </CardTitle>
          <CardDescription>
            Artifacts render in a sandboxed panel next to the conversation and can be exported as a
            static page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Nothing here yet"
            description="Ask a model to build a small web page or diagram and it will appear in this gallery."
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}