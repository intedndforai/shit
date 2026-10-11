import type { Metadata } from "next";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { AccentPicker } from "@/components/accent-picker";
import { PageShell } from "@/components/layout/page-shell";
import { ProviderManager } from "@/components/settings/provider-manager";
import { ToolsManager } from "@/components/settings/tools-manager";
import { MemoryManager } from "@/components/settings/memory-manager";
import { ModelRolesManager } from "@/components/settings/model-roles";
import { PresetsManager } from "@/components/settings/presets-manager";
import { ProfileManager } from "@/components/settings/profile-manager";
import { PromptsManager } from "@/components/settings/prompts-manager";
import { StylesManager } from "@/components/settings/styles-manager";
import { ThemeSelect } from "@/components/settings/theme-select";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageShell
      title="Settings"
      description="Appearance, personalization, providers, and data. Everything here is stored locally on your machine."
    >
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Pick a theme and an accent color. Every color is a CSS variable, so the look is fully
            restyleable.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label htmlFor="theme-select">Theme</Label>
            <ThemeSelect />
          </div>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label>Accent color</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Used for highlights and the send button.
              </p>
            </div>
            <AccentPicker />
          </div>
        </CardContent>
      </Card>

      <ProfileManager />

      <ProviderManager />

      <StylesManager />

      <MemoryManager />

      <PromptsManager />

      <ToolsManager />

      <ModelRolesManager />

      <PresetsManager />

      <Card>
        <CardHeader>
          <CardTitle>Data and storage</CardTitle>
          <CardDescription>
            Conduit runs single-user by default and keeps everything in a local SQLite database. A
            browser-only mode arrives with the chat UI.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Server database</span>
            <code className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs">SQLITE_PATH</code>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Key encryption</span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-accent" />
              AES-256-GCM
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Authentication</span>
            <Badge variant="outline">Single user (auth-less)</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-secondary/40">
        <CardContent className="flex flex-col gap-2 p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Conduit 0.1.0 · MIT license</p>
          <p>
            An open-source, provider-agnostic chat client. No vendor lock-in, no telemetry, no
            hardcoded AI vendor.
          </p>
          <a
            className="inline-flex w-fit items-center gap-1.5 text-accent hover:underline"
            href="https://nextjs.org/docs"
            target="_blank"
            rel="noreferrer"
          >
            Built with Next.js <ExternalLink className="size-3.5" />
          </a>
        </CardContent>
      </Card>
    </PageShell>
  );
}