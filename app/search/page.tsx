import type { Metadata } from "next";
import { Search } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <PageShell
      title="Search"
      description="Full-text search across every chat and message you have stored."
      actions={<Badge variant="warning">Milestone 3</Badge>}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="size-4 text-accent" />
            Search your history
          </CardTitle>
          <CardDescription>
            Press Ctrl+K anywhere to search titles and message content, jump to a match, and pin the
            chats you revisit most.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No chats to search yet"
            description="Once you start chatting, this view lists matches with highlighted snippets."
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}