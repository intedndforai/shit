import { NextResponse } from "next/server";
import { dbHealth } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + database probe used by Docker health checks and the UI. */
export async function GET() {
  const db = dbHealth();
  return NextResponse.json(
    {
      status: db.ok ? "ok" : "degraded",
      app: "conduit",
      version: "0.1.0",
      database: { reachable: db.ok },
      timestamp: new Date().toISOString(),
    },
    { status: db.ok ? 200 : 503 }
  );
}