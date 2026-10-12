"use client";

import { useTheme } from "next-themes";
import { useIsMounted } from "@/lib/hooks/use-mounted";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();

  if (!mounted) return <Skeleton className="h-9 w-40" />;

  return (
    <Select value={theme ?? "system"} onValueChange={setTheme}>
      <SelectTrigger id="theme-select" className="w-40" aria-label="Theme">
        <SelectValue placeholder="Select theme" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
        <SelectItem value="contrast">High contrast</SelectItem>
        <SelectItem value="system">System</SelectItem>
      </SelectContent>
    </Select>
  );
}