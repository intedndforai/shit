"use client";

import Link from "next/link";
import { BookOpen, Compass, FileText, Sparkles, Waypoints } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { greetingForHour } from "@/lib/utils";
import { useUIStore } from "@/lib/store/ui-store";

const SUGGESTIONS = [
  {
    icon: Sparkles,
    title: "Draft something",
    prompt: "Help me write a short product update about what we shipped this week.",
  },
  {
    icon: Compass,
    title: "Explore an idea",
    prompt: "Compare RAG and long-context prompting for a personal document assistant.",
  },
  {
    icon: FileText,
    title: "Summarize",
    prompt: "Summarize this document into five bullets and one action item.",
  },
  {
    icon: BookOpen,
    title: "Explain",
    prompt: "Explain how server-sent events work, with a small example.",
  },
];

export function EmptyState() {
  const setDraft = useUIStore((state) => state.setComposerDraft);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Waypoints className="size-5" />
        </span>
        <p className="text-sm text-muted-foreground">{greetingForHour()}</p>
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
          What would you like to explore?
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Conduit is provider-agnostic. Add any Base URL and API key, then chat with the models you
          already pay for.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.title}
            type="button"
            onClick={() => setDraft(suggestion.prompt)}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-accent/60 hover:bg-secondary/50"
          >
            <suggestion.icon className="mt-0.5 size-4 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{suggestion.title}</span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">
                {suggestion.prompt}
              </span>
            </span>
          </button>
        ))}
      </div>

      <Card className="bg-secondary/40">
        <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Connect your first model</p>
            <p className="text-xs text-muted-foreground">
              Providers, keys, and model capabilities live in Settings. Keys stay on the server.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">Open Settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}