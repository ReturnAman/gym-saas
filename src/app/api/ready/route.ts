import { NextResponse } from "next/server";

import {
  resolveCorrelationId,
  withCorrelationId,
} from "@/lib/server/correlation";
import { db } from "@/lib/server/db";
import {
  classifyDatabaseError,
  DATABASE_UNAVAILABLE_BODY,
} from "@/lib/server/db-errors";
import {
  logDatabaseFailure,
  logUnexpectedError,
} from "@/lib/server/logger";

// Readiness probe: the app is up AND its database is reachable.
// Deliberately separate from /api/health (shallow liveness): a
// database outage must not mark an otherwise healthy process down,
// but deploy smoke tests and uptime checks need one glance that
// separates "app up, DB down" from "app down". The check is a single
// SELECT 1 on the existing pooled client — no new client, pool, or
// schema — and the response exposes nothing beyond readiness: no
// counts, no version, no environment details. Failures return the
// shared generic database-unavailable body; raw driver errors are
// only logged, never returned.
export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request);
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    if (classifyDatabaseError(error)) {
      logDatabaseFailure({ boundary: "GET /api/ready", requestId, error });
    } else {
      logUnexpectedError({ boundary: "GET /api/ready", requestId, error });
    }
    return withCorrelationId(
      NextResponse.json(DATABASE_UNAVAILABLE_BODY, { status: 503 }),
      requestId,
    );
  }
  return withCorrelationId(
    NextResponse.json({ service: "gym-saas", status: "ready" }),
    requestId,
  );
}
