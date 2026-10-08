import { NextResponse } from "next/server";

import { MemberValidationError } from "@/lib/members";
import { requestMemberOtp } from "@/lib/server/member-auth";
import { SmsProviderError } from "@/lib/server/sms-provider";

/**
 * POST /api/member-auth/otp/request — public member-auth endpoint.
 *
 * This route is intentionally NOT Clerk-authenticated (members have no
 * account yet); Clerk remains untouched for owners/staff. The response is
 * anti-enumeration by contract: an eligible request, an ineligible phone,
 * and a rate-limited phone all return the same 200 { challengeId } shape —
 * see requestMemberOtp. Only a provider outage is distinguishable (503),
 * because it applies to every phone equally and reveals nothing about
 * membership.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError();
  }
  const { organizationId, phoneNumber } = (body ?? {}) as {
    organizationId?: unknown;
    phoneNumber?: unknown;
  };
  if (
    typeof organizationId !== "string" ||
    organizationId.trim() === "" ||
    typeof phoneNumber !== "string"
  ) {
    return validationError();
  }

  try {
    const { challengeId } = await requestMemberOtp({
      organizationId,
      phoneNumber,
    });
    return NextResponse.json({ challengeId });
  } catch (error) {
    if (error instanceof MemberValidationError) {
      return validationError();
    }
    if (error instanceof SmsProviderError) {
      return NextResponse.json(
        {
          error: {
            code: "OTP_UNAVAILABLE",
            message: "We could not send a code right now. Please try again later.",
          },
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong. Please try again.",
        },
      },
      { status: 500 },
    );
  }
}

function validationError() {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Organization and a valid 10-digit phone number are required.",
      },
    },
    { status: 400 },
  );
}
