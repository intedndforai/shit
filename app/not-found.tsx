import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="font-serif text-2xl font-medium">This page does not exist</h1>
      <Button asChild variant="outline">
        <Link href="/">Back to chat</Link>
      </Button>
    </div>
  );
}