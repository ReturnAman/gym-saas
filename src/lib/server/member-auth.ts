import "server-only";

import { randomUUID } from "node:crypto";

import { validatePhoneNumber } from "../members";
import { db } from "./db";
import {
  OtpRateLimitError,
  OtpVerificationError,
  issueChallenge,
  verifyChallenge,
} from "./otp-service";

/**
 * MemberAuth — the application-facing member OTP facade
 * (02-USER-FLOWS §9). Routes call only this module.
 *
 * This is a SEPARATE authentication path from Clerk (which continues to
 * serve owners/staff untouched): no Clerk session is read or created here,
 * and no member session or account linking happens in this foundation —
 * a successful verify produces a VERIFIED challenge that a later linking
 * slice consumes.
 *
 * Anti-enumeration contract: requestMemberOtp always resolves with a
 * challenge id. When the phone is not eligible — or a rate limit trips —
 * the id is synthetic (a random UUID with no challenge behind it), so the
 * response reveals nothing about whether the phone belongs to a member of
 * the gym. Verification against a synthetic id fails generically, like
 * every other verification failure.
 */

/**
 * Request an OTP for member authentication at one gym.
 *
 * Eligibility (approved V1 definition): ANY Member row in the organization
 * has this phone number — an active membership is not required. Ineligible
 * phones receive no SMS and a synthetic challenge id.
 */
export async function requestMemberOtp(input: {
  organizationId: string;
  phoneNumber: string;
}): Promise<{ challengeId: string }> {
  // Authoritative phone validation (canonical 10-digit format). Throws
  // MemberValidationError on malformed input — a shape error, safe to
  // surface as a validation response.
  const phoneNumber = validatePhoneNumber(input.phoneNumber);

  const member = await db.member.findFirst({
    where: { organizationId: input.organizationId, phoneNumber },
    select: { id: true },
  });
  if (!member) {
    return { challengeId: randomUUID() };
  }

  try {
    return await issueChallenge({
      organizationId: input.organizationId,
      phoneNumber,
    });
  } catch (error) {
    if (error instanceof OtpRateLimitError) {
      // Indistinguishable from the ineligible response by design: a real
      // rate-limit signal here would reveal that this phone has recent
      // challenges — i.e. that it belongs to a member.
      return { challengeId: randomUUID() };
    }
    throw error;
  }
}

/**
 * Verify an OTP entered by a member. Every failure — unknown challenge,
 * wrong gym, expired, locked, wrong code, malformed code — surfaces as the
 * same OtpVerificationError; the route renders one generic response.
 */
export async function verifyMemberOtp(input: {
  organizationId: string;
  challengeId: string;
  otp: string;
}): Promise<{ verified: true }> {
  // A well-formed code is exactly 6 digits (2Factor AUTOGEN). Anything else
  // cannot be the issued code: fail generically without consuming an
  // attempt or calling the provider.
  const otp = input.otp.trim();
  if (!/^[0-9]{6}$/.test(otp)) {
    throw new OtpVerificationError();
  }
  const result = await verifyChallenge({
    organizationId: input.organizationId,
    challengeId: input.challengeId,
    otp,
  });
  return { verified: result.verified };
}
