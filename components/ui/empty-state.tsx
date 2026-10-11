import { cn } from "@/lib/utils";

/** Compact empty state used inside cards and panels. */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center",
        className
      )}
    >
      {Icon ? <Icon className="size-5 text-muted-foreground" /> : null}
      <p className="font-serif text-base font-medium">{title}</p>
      {description ? (
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}