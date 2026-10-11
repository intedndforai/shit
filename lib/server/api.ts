import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

/** Shared JSON helpers for route handlers. */

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Parse and validate a JSON body, returning a readable error response. */
export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError("Request body must be valid JSON.", 400) };
  }

  try {
    return { ok: true, data: schema.parse(raw) };
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ");
      return { ok: false, response: jsonError(message, 422) };
    }
    return { ok: false, response: jsonError("Invalid request body.", 400) };
  }
}

/** Turn an unknown thrown value into a user-facing message + status. */
export function errorResponse(error: unknown) {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const safeStatus = typeof status === "number" && status >= 400 && status < 600 ? status : 500;
  return jsonError(message, safeStatus);
}