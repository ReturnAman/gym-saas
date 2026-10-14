import { NextResponse } from "next/server";

import {
  resolveCorrelationId,
  withCorrelationId,
} from "@/lib/server/correlation";
import {
  classifyDatabaseError,
  DATABASE_UNAVAILABLE_BODY,
} from "@/lib/server/db-errors";
import {
  logDatabaseFailure,
  logUnexpectedError,
} from "@/lib/server/logger";
import { linkMember } from "@/lib/server/member-auth";
import { MemberLinkingError } from "@/lib/server/member-linking";
import {
  isSameOriginRequest,
  setMemberSessionCookie,
} from "@/lib/server/member-session";

/**
 * POST /api/member-auth/link — consume a VERIFIED OTP challenge.
 *
 * Public member-auth endpoint (no Clerk — members authenticate by phone
 * OTP, ADR 021). On success the linking transaction has already committed
 * when the facade resolves; only then is the gym-scoped member session
 * cookie set. The raw session token appears only in that HttpOnly cookie —
 * never in the response body. EVERY failure returns the same generic body:
 * unknown challenge, wrong gym, not verified, already consumed, outside
 * the 5-minute window, or any duplicate/link rule outcome are
 * indistinguishable.
 */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request);
  if (!isSameOriginRequest(request)) {
    return genericFailure();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return genericFailure();
  }
  const { organizationId, challengeId } = (body ?? {}) as {
    organizationId?: unknown;
    challengeId?: unknown;
  };
  if (
    typeof organizationId !== "string" ||
    organizationId.trim() === "" ||
    typeof challengeId !== "string" ||
    challengeId.trim() === ""
  ) {
    return genericFailure();
  }

  try {
    const { rawToken } = await linkMember({ organizationId, challengeId });
    const response = NextResponse.json({ linked: true });
    await setMemberSessionCookie(rawToken);
    return response;
  } catch (error) {
    if (error instanceof MemberLinkingError) {
      return genericFailure();
    }
    if (classifyDatabaseError(error)) {
      logDatabaseFailure({
        boundary: "POST /api/member-auth/link",
        requestId,
        error,
      });
      return withCorrelationId(
        NextResponse.json(DATABASE_UNAVAILABLE_BODY, { status: 503 }),
        requestId,
      );
    }
    logUnexpectedError({
      boundary: "POST /api/member-auth/link",
      requestId,
      error,
    });
    return withCorrelationId(
      NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong. Please try again.",
          },
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}

function genericFailure() {
  return NextResponse.json(
    {
      error: {
        code: "LINK_FAILED",
        message:
          "We could not complete sign-in. Please request a new code and try again, or ask the gym for help.",
      },
    },
    { status: 400 },
  );
}
