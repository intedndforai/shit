"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SidebarNav } from "@/components/layout/sidebar";
import { useUIStore } from "@/lib/store/ui-store";

/** Slide-in navigation for small screens. */
export function MobileNav() {
  const open = useUIStore((state) => state.mobileNavOpen);
  const setOpen = useUIStore((state) => state.setMobileNavOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        className="left-0 top-0 h-dvh w-[19rem] max-w-[85vw] translate-x-0 translate-y-0 rounded-none rounded-r-2xl border-y-0 border-l-0 p-3"
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}