import type { Metadata } from "next";
import { PageShell } from "@/components/layout/page-shell";
import { ProjectManager } from "@/components/projects/project-manager";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <PageShell
      title="Projects"
      description="Group chats around a knowledge base with instructions, files, and retrieval."
    >
      <ProjectManager />
    </PageShell>
  );
}