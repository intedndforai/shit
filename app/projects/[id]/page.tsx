"use client";

import { useParams } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { ProjectDetail } from "@/components/projects/project-detail";

/** One project workspace: instructions, knowledge base, and scoped chats. */
export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  return (
    <PageShell
      title="Project"
      description="Instructions, a searchable knowledge base, and every chat that belongs to this project."
    >
      {id ? <ProjectDetail projectId={id} /> : null}
    </PageShell>
  );
}