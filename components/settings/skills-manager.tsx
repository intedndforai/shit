"use client";

import * as React from "react";
import {
  Check,
  Download,
  History,
  Import,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, type SkillDto, type SkillVersionDto } from "@/lib/api-client";

const TRUST_LABEL: Record<
  string,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> | null }
> = {
  trusted: { label: "trusted", className: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400", icon: ShieldCheck },
  reviewed: { label: "reviewed", className: "border-sky-500/40 text-sky-600 dark:text-sky-400", icon: ShieldQuestion },
  untrusted: { label: "untrusted", className: "border-amber-500/40 text-amber-600 dark:text-amber-400", icon: ShieldAlert },
};

const SOURCE_LABEL: Record<string, string> = {
  builtin: "built-in",
  user: "yours",
  imported: "imported",
  verified: "verified",
};

type EditorState = {
  id: string | null;
  skillKey: string;
  version: number;
  name: string;
  description: string;
  taskTypes: string;
  instructions: string;
  requiredTools: string;
};

const EMPTY_EDITOR: EditorState = {
  id: null,
  skillKey: "",
  version: 1,
  name: "",
  description: "",
  taskTypes: "",
  instructions: "",
  requiredTools: "",
};

/**
 * Skills are versioned instruction packs. Built-ins ship with the app; your own
 * skills live here too, and any skill can be assigned to a project so its
 * instructions reach the model in project chats. Skills are prompt text only -
 * nothing in a skill is ever executed.
 */
export function SkillsManager() {
  const [skills, setSkills] = React.useState<SkillDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState<string>("all");
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [versionsFor, setVersionsFor] = React.useState<SkillDto | null>(null);
  const [versions, setVersions] = React.useState<SkillVersionDto[]>([]);
  const [importDialog, setImportDialog] = React.useState(false);
  const [importText, setImportText] = React.useState("");


  React.useEffect(() => {
    let cancelled = false;
    api
      .listSkills()
      .then(({ skills: stored }) => {
        if (!cancelled) setSkills(stored);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load skills.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((skill) => {
      const matchesQuery =
        !q ||
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.taskTypes.some((type) => type.toLowerCase().includes(q));
      const matchesSource = sourceFilter === "all" || skill.source === sourceFilter;
      return matchesQuery && matchesSource;
    });
  }, [query, skills, sourceFilter]);

  const openCreate = () => {
    setEditor({ ...EMPTY_EDITOR });
  };

  const openEdit = (skill: SkillDto) => {
    setEditor({
      id: skill.id,
      skillKey: skill.skillKey,
      version: skill.version,
      name: skill.name,
      description: skill.description,
      taskTypes: skill.taskTypes.join(", "),
      instructions: skill.instructions,
      requiredTools: skill.requiredTools.join(", "),
    });
  };

  const save = async () => {
    if (!editor) return;
    const name = editor.name.trim();
    const instructions = editor.instructions.trim();
    if (!name || !instructions) {
      setError("A skill needs a name and instructions.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        description: editor.description.trim(),
        taskTypes: editor.taskTypes.split(",").map((t) => t.trim()).filter(Boolean),
        instructions,
        requiredTools: editor.requiredTools.split(",").map((t) => t.trim()).filter(Boolean),
      };
      if (editor.id) {
        const { skill } = await api.updateSkill(editor.id, body);
        setSkills((current) => {
          const rest = current.filter((item) => item.skillKey !== skill.skillKey);
          return [skill, ...rest];
        });
        setNotice(`Saved ${skill.name} as version ${skill.version}.`);
      } else {
        const { skill } = await api.createSkill(body);
        setSkills((current) => [skill, ...current]);
        setNotice(`Created ${skill.name}.`);
      }
      setEditor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that skill.");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (skill: SkillDto) => {
    try {
      const { skill: updated } = await api.updateSkill(skill.id, { enabled: !skill.enabled });
      setSkills((current) =>
        current.map((item) => (item.skillKey === updated.skillKey ? updated : item))
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not toggle that skill.");
    }
  };

  const markReviewed = async (skill: SkillDto) => {
    setBusy(true);
    setError(null);
    try {
      const { skill: updated } = await api.updateSkill(skill.id, { trustStatus: "reviewed" });
      setSkills((current) =>
        current.map((item) => (item.skillKey === updated.skillKey ? updated : item))
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update trust status.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skill: SkillDto) => {
    if (!window.confirm(`Delete "${skill.name}" and all of its versions?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteSkill(skill.id);
      setSkills((current) => current.filter((item) => item.skillKey !== skill.skillKey));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that skill.");
    } finally {
      setBusy(false);
    }
  };

  const showVersions = async (skill: SkillDto) => {
    setVersionsFor(skill);
    setVersions([]);
    try {
      const { versions: stored } = await api.getSkill(skill.id);
      setVersions(stored);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load versions.");
    }
  };

  const restoreVersion = async (version: SkillVersionDto) => {
    if (!versionsFor) return;
    if (!window.confirm(`Restore version ${version.version} of "${versionsFor.name}"? This publishes a new version.`)) return;
    setBusy(true);
    setError(null);
    try {
      const { skill } = await api.updateSkill(versionsFor.id, { restoreVersion: version.version });
      setSkills((current) => {
        const rest = current.filter((item) => item.skillKey !== skill.skillKey);
        return [skill, ...rest];
      });
      setVersionsFor(null);
      setNotice(`Restored version ${version.version} as version ${skill.version}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore that version.");
    } finally {
      setBusy(false);
    }
  };

  const exportSkill = async (skill: SkillDto) => {
    try {
      const { skill: payload, filename } = await api.exportSkill(skill.id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export that skill.");
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { skill, trustStatus } = await api.importSkill(importText);
      setSkills((current) => [skill, ...current]);
      setImportDialog(false);
      setImportText("");
      setNotice(
        trustStatus === "trusted"
          ? `Imported "${skill.name}" from a trusted source.`
          : `Imported "${skill.name}" - ${trustStatus}. Review it before assigning it to a project.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import that skill.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          Skills
        </CardTitle>
        <CardDescription>
          Versioned instruction packs for project work. Assign them to a project to make them
          active in that project&apos;s chats. Skills are prompt text only - nothing in a skill is
          ever executed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-foreground">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills…"
            className="max-w-xs"
          />
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {["all", "builtin", "user", "imported", "verified"].map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setSourceFilter(source)}
                className={
                  "rounded-md px-2 py-1 text-xs transition-colors " +
                  (sourceFilter === source
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {source === "all" ? "All" : SOURCE_LABEL[source] ?? source}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportDialog(true)} disabled={busy}>
              <Import className="size-3.5" /> Import
            </Button>
            <Button size="sm" variant="accent" onClick={openCreate} disabled={busy}>
              <Plus className="size-3.5" /> New skill
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {skills.length === 0
              ? "No skills yet. Create one, or import a JSON skill from another Conduit installation."
              : "No skills match that search."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((skill) => {
  const trust = TRUST_LABEL[skill.trustStatus] ?? TRUST_LABEL.untrusted;
  const TrustIcon = trust.icon;
  return (
                <li key={skill.id} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{skill.name}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">v{skill.version}</Badge>
                      <Badge variant="outline">{SOURCE_LABEL[skill.source] ?? skill.source}</Badge>
                      <Badge variant="outline" className={trust.className} title={trustLabel(skill)}>
                        {TrustIcon ? <TrustIcon className="size-2.5" /> : null}
                        {trust.label}
                      </Badge>
                    </p>
                    {skill.description ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {skill.taskTypes.slice(0, 4).map((type) => (
                        <span key={type} className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {type}
                        </span>
                      ))}
                      {skill.assignedProjects > 0 ? (
                        <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                          {skill.assignedProjects} project{skill.assignedProjects === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {skill.source === "imported" || skill.source === "verified" ? (
                        <span className="max-w-48 truncate text-[10px] text-muted-foreground" title={skill.provenance.url ?? undefined}>
                          {skill.provenance.url ?? "no source URL"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Switch
                      checked={skill.enabled}
                      onCheckedChange={() => void toggleEnabled(skill)}
                      aria-label={`Toggle ${skill.name}`}
                      disabled={busy}
                    />
                    <div className="flex items-center gap-0.5">
                      {skill.trustStatus === "untrusted" ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Mark ${skill.name} as reviewed`}
                          title="Mark as reviewed"
                          disabled={busy}
                          onClick={() => void markReviewed(skill)}
                        >
                          <ShieldCheck className="size-3.5" />
                        </Button>
                      ) : null}
                      <Button size="icon-sm" variant="ghost" aria-label={`History of ${skill.name}`} title="Version history" disabled={busy} onClick={() => void showVersions(skill)}>
                        <History className="size-3.5" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Export ${skill.name}`} title="Export JSON" disabled={busy} onClick={() => void exportSkill(skill)}>
                        <Download className="size-3.5" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${skill.name}`} title="Edit (publishes a new version)" disabled={busy} onClick={() => openEdit(skill)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${skill.name}`}
                        title="Delete skill and all versions"
                        disabled={busy}
                        onClick={() => void remove(skill)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {editor ? (
        <Dialog open onOpenChange={(open) => !open && setEditor(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editor.id ? `Edit ${editor.name}` : "New skill"}</DialogTitle>
              <DialogDescription>
                {editor.id
                  ? `Saving publishes version ${editor.version + 1}; older versions stay in history.`
                  : "Give the skill a name and the instructions the model should follow."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-name">Name</Label>
                  <Input
                    id="skill-name"
                    value={editor.name}
                    onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                    placeholder="Review a codebase"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-tasks">Task types (comma separated)</Label>
                  <Input
                    id="skill-tasks"
                    value={editor.taskTypes}
                    onChange={(event) => setEditor({ ...editor, taskTypes: event.target.value })}
                    placeholder="review, code, project"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-desc">Description</Label>
                <Input
                  id="skill-desc"
                  value={editor.description}
                  onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                  placeholder="What is this skill for?"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-instructions">Instructions</Label>
                <Textarea
                  id="skill-instructions"
                  rows={8}
                  value={editor.instructions}
                  onChange={(event) => setEditor({ ...editor, instructions: event.target.value })}
                  placeholder="Tell the model what to do, in what order, and how to report results."
                />
                <p className="text-[11px] text-muted-foreground">
                  Prompt text only - skills never execute code or grant permissions. The model is
                  told these instructions are user-editable guidance.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-tools">Required tools (comma separated, advisory)</Label>
                <Input
                  id="skill-tools"
                  value={editor.requiredTools}
                  onChange={(event) => setEditor({ ...editor, requiredTools: event.target.value })}
                  placeholder="project_read, web_search"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button>
              <Button variant="accent" disabled={busy} onClick={() => void save()}>
                <Check className="size-3.5" /> Save{editor.id ? ` as v${editor.version + 1}` : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {versionsFor ? (
        <Dialog open onOpenChange={(open) => !open && setVersionsFor(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Versions of {versionsFor.name}</DialogTitle>
              <DialogDescription>
                Each edit publishes a new version. Restoring copies an older version forward as a
                new one.
              </DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-2">
              {versions.length === 0 ? (
                <li className="text-xs text-muted-foreground">Loading versions…</li>
              ) : (
                versions.map((version) => (
                  <li key={version.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        Version {version.version}
                        {version.version === versionsFor.version ? <Badge variant="outline">current</Badge> : null}
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(version.createdAt).toLocaleString()}
                        </span>
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{version.description || version.instructions}</p>
                    </div>
                    {version.version !== versionsFor.version ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void restoreVersion(version)}>
                        Restore
                      </Button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </DialogContent>
        </Dialog>
      ) : null}

      {importDialog ? (
        <Dialog open onOpenChange={(open) => !open && setImportDialog(false)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Import a skill</DialogTitle>
              <DialogDescription>
                Paste the JSON exported from another Conduit installation. Only prompt text is
                accepted - payloads declaring executable code are rejected. Imported skills are
                labeled <Badge variant="outline" className="text-[10px]">untrusted</Badge> unless
                their provenance URL is on Conduit&apos;s trusted-sources list; review them before
                assigning them to a project.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              rows={10}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={'{"name": "My skill", "description": "...", "instructions": "...", "taskTypes": ["research"], "provenance": {"url": "https://..."}}'}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setImportDialog(false)}>Cancel</Button>
              <Button variant="outline" onClick={() => {
                if (!importText.trim()) return;
                setImportText(JSON.stringify({
                  name: "Example research skill",
                  description: "Runs a short research loop with citations.",
                  taskTypes: ["research"],
                  instructions: "Plan 2-3 searches, fetch the top results, then synthesize with numbered citations. Only cite pages you actually fetched.",
                  requiredTools: ["web_search", "web_fetch"],
                  provenance: { url: "https://github.com/example/research-skill" },
                }, null, 2));
              }}>
                <Upload className="size-3.5" /> Fill example
              </Button>
              <Button variant="accent" disabled={busy || !importText.trim()} onClick={() => void doImport()}>
                <Check className="size-3.5" /> Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}

function trustLabel(skill: SkillDto): string {
  if (skill.trustStatus === "trusted") return "Trusted - from a curated source domain";
  if (skill.trustStatus === "reviewed") return "Reviewed - you checked this skill";
  return "Untrusted - review before assigning to a project";
}