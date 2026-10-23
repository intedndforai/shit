"use client";

import * as React from "react";
import { ImageOff, Loader2 } from "lucide-react";

function hostOf(value?: string): string {
  if (!value) return "unknown host";
  try {
    return new URL(value).hostname;
  } catch {
    return "unknown host";
  }
}

/**
 * Remote images are blocked by default (Section 3.2): an image URL can leak a
 * request, an IP, and a referrer to a third party. The user loads one image at a
 * time, and it is fetched with no referrer.
 */
export function RemoteImage({ src, alt }: { src?: string; alt?: string }) {
  const [state, setState] = React.useState<"blocked" | "loading" | "shown">("blocked");
  // A root-relative path (but not `//host/...`) is this app's own bytes, served
  // from /api/files/..., so loading it makes no third-party request.
  const local = Boolean(src && (/^(data:|blob:)/i.test(src) || (/^\/(?!\/)/.test(src))));

  if (local && src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt ?? ""} className="my-2 max-w-full rounded-lg" />;
  }

  const blocked = !src || state === "blocked";
  if (blocked) {
    return (
      <span className="my-2 inline-flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-secondary/40 px-2.5 py-1.5 text-xs text-muted-foreground">
        <ImageOff className="size-3.5 shrink-0" aria-hidden />
        <span>
          Remote image blocked ·{" "}
          {alt ? (
            <>
              <span className="text-foreground">{alt}</span>{" "}
              <span className="font-mono">({hostOf(src)})</span>
            </>
          ) : (
            <span className="font-mono">{hostOf(src)}</span>
          )}
        </span>
        {src ? (
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-secondary"
            onClick={() => setState("loading")}
          >
            Load image
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <span className="my-2 block">
      {state === "loading" ? (
        <span className="mb-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading {hostOf(src)}…
        </span>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setState("shown")}
        onError={() => setState("blocked")}
        className="max-w-full rounded-lg"
      />
    </span>
  );
}
