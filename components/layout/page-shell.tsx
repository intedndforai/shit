import { cn } from "@/lib/utils";

/** Consistent page container for non-chat routes (Settings, Projects, ...). */
export function PageShell({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn("mx-auto w-full max-w-3xl px-4 py-8", className)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-medium tracking-tight">{title}</h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </div>
        <div className="mt-6 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}