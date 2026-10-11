"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type SkillDto } from "@/lib/api-client";

/**
 * Skills assigned to a project become active in every chat scoped to it: their
 * instructions are added to the system prompt and the model can follow or
 * ignore them. Disabled skills never reach the model.
 */
export function ProjectSkills({ projectId }: { projectId: string }) {
  const [allSkills, setAllSkills] = React.useState<SkillDto[]>([]);
  const [assigned, setAssigned] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([api.listSkills(), api.getProjectSkills(projectId)])
      .then(([all, project]) => {
        if (cancelled) return;
        setAllSkills(all.skills);
        setAssigned(new Set(project.skills.map((skill) => skill.skillKey)));
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
  }, [projectId]);

  const toggle = async (skill: SkillDto) => {
    const isAssigned = assigned.has(skill.skillKey);
    setBusy(true);
    setError(null);
    try {
      const result = isAssigned
        ? await api.unassignProjectSkill(projectId, skill.id)
        : await api.assignProjectSkill(projectId, skill.id);
      setAssigned(new Set(result.skills.map((item) => item.skillKey)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update that skill.");
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
          Assigned skills add their instructions to this project&apos;s chats. Toggle a skill on to
          assign it to this project; disable it in Settings to remove it everywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : allSkills.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No skills yet. Create or import one in Settings → Skills, then assign it here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {allSkills.map((skill) => {
              const on = assigned.has(skill.skillKey);
              return (
                <li
                  key={skill.id}
                  className={
                    "flex items-center gap-3 rounded-lg border px-3 py-2 transition-opacity " +
                    (on ? "border-accent/40 bg-accent/5" : "border-border")
                  }
                >
                  <input
                    type="checkbox"
                    id={`skill-${skill.skillKey}`}
                    checked={on}
                    disabled={busy}
                    onChange={() => void toggle(skill)}
                    className="size-4 shrink-0 accent-[var(--accent)]"
                  />
                  <label
                    htmlFor={`skill-${skill.skillKey}`}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {skill.name}
                      <Badge variant="outline" className="font-mono text-[10px]">v{skill.version}</Badge>
                      {!skill.enabled ? <Badge variant="warning">disabled</Badge> : null}
                    </span>
                    <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">
                      {skill.description || (skill.taskTypes.length ? skill.taskTypes.join(", ") : "No description")}
                    </span>
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-xs"
                    disabled={busy}
                    onClick={() => void toggle(skill)}
                  >
                    {on ? "Remove" : "Assign"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}