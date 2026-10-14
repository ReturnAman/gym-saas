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
  logProviderUnavailable,
  logUnexpectedError,
} from "@/lib/server/logger";
import { verifyMemberOtp } from "@/lib/server/member-auth";
import { OtpVerificationError } from "@/lib/server/otp-service";
import { SmsProviderError } from "@/lib/server/sms-provider";

/**
 * POST /api/member-auth/otp/verify — public member-auth endpoint.
 *
 * Not Clerk-authenticated (see the request route). EVERY verification
 * failure returns the same generic 400 body — unknown challenge, wrong
 * gym, expired, locked, already verified, or wrong code are
 * indistinguishable to the caller. A provider outage returns 503 (it is
 * global, not challenge-specific, so it reveals nothing).
 */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return genericFailure();
  }
  const { organizationId, challengeId, otp } = (body ?? {}) as {
    organizationId?: unknown;
    challengeId?: unknown;
    otp?: unknown;
  };
  if (
    typeof organizationId !== "string" ||
    organizationId.trim() === "" ||
    typeof challengeId !== "string" ||
    challengeId.trim() === "" ||
    typeof otp !== "string"
  ) {
    return genericFailure();
  }

  try {
    await verifyMemberOtp({ organizationId, challengeId, otp });
    return NextResponse.json({ verified: true });
  } catch (error) {
    if (error instanceof OtpVerificationError) {
      return genericFailure();
    }
    if (error instanceof SmsProviderError) {
      logProviderUnavailable({
        boundary: "POST /api/member-auth/otp/verify",
        requestId,
      });
      return withCorrelationId(
        NextResponse.json(
          {
            error: {
              code: "OTP_UNAVAILABLE",
              message: "We could not verify the code right now. Please try again later.",
            },
          },
          { status: 503 },
        ),
        requestId,
      );
    }
    if (classifyDatabaseError(error)) {
      logDatabaseFailure({
        boundary: "POST /api/member-auth/otp/verify",
        requestId,
        error,
      });
      return withCorrelationId(
        NextResponse.json(DATABASE_UNAVAILABLE_BODY, { status: 503 }),
        requestId,
      );
    }
    logUnexpectedError({
      boundary: "POST /api/member-auth/otp/verify",
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
        code: "INVALID_OR_EXPIRED_CODE",
        message: "That code is invalid or has expired. Request a new code and try again.",
      },
    },
    { status: 400 },
  );
}
