"use client";

import * as React from "react";
import { Check, Loader2, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type ProfileDto } from "@/lib/api-client";

const EMPTY: ProfileDto = { name: "", role: "", instructions: "" };

/**
 * Profile and preferences. These instructions are layered onto every chat's
 * system prompt, so they apply across the whole app.
 */
export function ProfileManager() {
  const [profile, setProfile] = React.useState<ProfileDto>(EMPTY);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getProfile()
      .then(({ profile: stored }) => {
        if (!cancelled) setProfile(stored);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load your profile.");
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
      const result = await api.saveProfile(profile);
      setProfile(result.profile);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-4 text-accent" />
          Profile and preferences
        </CardTitle>
        <CardDescription>
          Who you are and how you like answers. Applied to every chat that does not override it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={profile.name}
                  placeholder="e.g. Amara"
                  onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-role">Role</Label>
                <Input
                  id="profile-role"
                  value={profile.role}
                  placeholder="e.g. Backend engineer"
                  onChange={(event) => setProfile((current) => ({ ...current, role: event.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-instructions">How should the AI respond?</Label>
              <Textarea
                id="profile-instructions"
                rows={3}
                value={profile.instructions}
                placeholder="e.g. Lead with the answer, then the reasoning. Use metric units."
                onChange={(event) =>
                  setProfile((current) => ({ ...current, instructions: event.target.value }))
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="accent" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save profile
              </Button>
              {saved ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5 text-accent" /> Saved
                </span>
              ) : null}
              {error ? <span className="text-xs text-destructive">{error}</span> : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}