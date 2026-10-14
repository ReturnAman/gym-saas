import { NextResponse } from "next/server";

import {
  resolveCorrelationId,
  withCorrelationId,
} from "@/lib/server/correlation";

// Shallow liveness check: the app boots and serves traffic.
// (Deep checks — e.g. database reachability — belong to a separate
// readiness probe once the persistence layer is in use.)
export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request);
  return withCorrelationId(
    NextResponse.json({ service: "gym-saas", status: "ok" }),
    requestId,
  );
}
