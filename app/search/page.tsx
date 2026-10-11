import type { Metadata } from "next";
import { PageShell } from "@/components/layout/page-shell";
import { SearchPanel } from "@/components/search/search-panel";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <PageShell
      title="Search"
      description="Full-text search across every chat and message you have stored."
    >
      <SearchPanel />
    </PageShell>
  );
}