import { NextResponse } from "next/server";

// Shallow liveness check: the app boots and serves traffic.
// (Deep checks — e.g. database reachability — belong to a separate
// readiness probe once the persistence layer is in use.)
export async function GET() {
  return NextResponse.json({ service: "gym-saas", status: "ok" });
}
