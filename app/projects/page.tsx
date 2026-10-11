import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <PageShell
      title="Projects"
      description="Group chats around a knowledge base with instructions, files, and retrieval."
      actions={<Badge variant="warning">Milestone 8</Badge>}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="size-4 text-accent" />
            No projects yet
          </CardTitle>
          <CardDescription>
            Projects will hold uploaded documents, a custom instruction set, and every chat that
            belongs to them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Retrieval arrives in Milestone 8"
            description="Chunking, embeddings through your own endpoint, and top-k retrieval with citations."
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}