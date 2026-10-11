"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Full-size viewer for attached images. Esc, the close button, or clicking the
 * image closes it. The panel itself is kept bare so the photo is the focal point.
 */
export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-[92vw] border-none bg-transparent p-0 shadow-none sm:max-w-[92vw]">
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <button
          type="button"
          aria-label="Close image"
          onClick={() => onOpenChange(false)}
          className="block w-full cursor-zoom-out"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="mx-auto max-h-[88vh] w-auto max-w-full rounded-xl border border-border object-contain"
          />
        </button>
      </DialogContent>
    </Dialog>
  );
}
