import { NextResponse } from "next/server";

import { db } from "@/lib/server/db";
import {
  resolveCorrelationId,
  withCorrelationId,
} from "@/lib/server/correlation";

// Readiness is intentionally separate from /api/health: this endpoint proves
// that the application can execute a lightweight query against PostgreSQL.
// It never returns database error details to the caller.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request);

  try {
    await db.$queryRaw`SELECT 1`;
    return withCorrelationId(
      NextResponse.json({ service: "gym-saas", status: "ready" }),
      requestId,
    );
  } catch {
    return withCorrelationId(
      NextResponse.json(
        { service: "gym-saas", status: "not_ready" },
        { status: 503 },
      ),
      requestId,
    );
  }
}
