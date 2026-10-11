"use client";

import * as React from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { api, type ModelOptionDto, type RoleAssignmentsDto } from "@/lib/api-client";

const EMPTY: RoleAssignmentsDto = { title: null, summarization: null, embeddings: null };

const ROLES: Array<{ key: keyof RoleAssignmentsDto; label: string; hint: string }> = [
  {
    key: "title",
    label: "Title generation model",
    hint: "Writes short chat titles. A small, cheap model is ideal.",
  },
  {
    key: "summarization",
    label: "Summarization model",
    hint: "Compresses long conversations when the context window is nearly full.",
  },
  {
    key: "embeddings",
    label: "Embeddings model",
    hint: "Turns project files and questions into vectors. Without it, project retrieval falls back to keyword search and the endpoint must accept POST {baseUrl}/embeddings.",
  },
];

/**
 * Model roles. Each job can run on its own model; leaving one on "Default"
 * makes Conduit fall back to your default chat model.
 */
export function ModelRolesManager() {
  const [assignments, setAssignments] = React.useState<RoleAssignmentsDto>(EMPTY);
  const [models, setModels] = React.useState<ModelOptionDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getRoles()
      .then((result) => {
        if (cancelled) return;
        setAssignments(result.assignments);
        setModels(result.models);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load model roles.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api.saveRoles(assignments);
      setAssignments(result.assignments);
      setModels(result.models);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the model roles.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          Model roles
        </CardTitle>
        <CardDescription>
          Point the optional jobs at a specific model. Everything here also works with a single
          provider: leave a role on Default and your chat model handles it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : !models.length ? (
          <p className="text-xs text-muted-foreground">
            Add a provider and discover its models first — there is nothing to assign yet.
          </p>
        ) : (
          <>
            {ROLES.map((role) => (
              <div key={role.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`role-${role.key}`}>{role.label}</Label>
                <select
                  id={`role-${role.key}`}
                  className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-accent/70"
                  value={assignments[role.key] ?? ""}
                  onChange={(event) =>
                    setAssignments((current) => ({ ...current, [role.key]: event.target.value || null }))
                  }
                >
                  <option value="">Default (chat model)</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.providerName} · {model.displayName ?? model.externalId}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">{role.hint}</p>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="accent" disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Save roles
              </Button>
              {saved ? <span className="text-xs text-muted-foreground">Saved</span> : null}
              {error ? <span className="text-xs text-destructive">{error}</span> : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}