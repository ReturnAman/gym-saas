import { NextResponse } from "next/server";

import {
  resolveCorrelationId,
  withCorrelationId,
} from "@/lib/server/correlation";
import {
  classifyDatabaseError,
  DATABASE_UNAVAILABLE_BODY,
} from "@/lib/server/db-errors";
import { logDatabaseFailure } from "@/lib/server/logger";
import {
  clearMemberSessionCookie,
  isSameOriginRequest,
  readMemberSessionToken,
  revokeMemberSession,
} from "@/lib/server/member-session";

/**
 * POST /api/member-auth/logout — end the member session.
 *
 * Revocation is server-side: the session row is marked revoked, so the
 * token stops working everywhere immediately; clearing the cookie is just
 * hygiene. Idempotent — no cookie, an unknown token, or an already-revoked
 * session all return the same success. Origin-checked because the request
 * is authenticated by the cookie alone.
 */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request);
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Request origin could not be verified.",
        },
      },
      { status: 403 },
    );
  }
  try {
    await revokeMemberSession(await readMemberSessionToken());
  } catch (error) {
    if (classifyDatabaseError(error)) {
      // Revocation did not happen server-side — do not claim it did.
      // Still clear the local cookie so this browser stops presenting
      // the token; the session itself expires on its own schedule.
      logDatabaseFailure({
        boundary: "POST /api/member-auth/logout",
        requestId,
        error,
      });
      await clearMemberSessionCookie();
      return withCorrelationId(
        NextResponse.json(DATABASE_UNAVAILABLE_BODY, { status: 503 }),
        requestId,
      );
    }
    throw error;
  }
  await clearMemberSessionCookie();
  return withCorrelationId(
    NextResponse.json({ loggedOut: true }),
    requestId,
  );
}
