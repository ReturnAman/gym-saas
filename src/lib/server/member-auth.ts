import "server-only";

import { randomUUID } from "node:crypto";

import { validatePhoneNumber } from "../members";
import { db } from "./db";
import {
  submitJoinRequest,
  type SubmitJoinRequestInput,
  type SubmitJoinRequestResult,
} from "./member-join-requests";
import {
  linkVerifiedChallenge,
  type MemberLinkResult,
} from "./member-linking";
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
 * serve owners/staff untouched): no Clerk session is read or created here.
 * A successful verify produces a VERIFIED challenge; linking consumes it
 * to create the phone-backed User, Member link, and gym-scoped member
 * session (ADR 021).
 *
 * Anti-enumeration contract: requestMemberOtp always resolves with a
 * challenge id. When the phone is not eligible — or a rate limit trips —
 * the id is synthetic (a random UUID with no challenge behind it), so the
 * response reveals nothing about whether the phone belongs to a member of
 * the gym. Verification against a synthetic id fails generically, like
 * every other verification failure.
 *
 * Intent: requestMemberOtp takes an `intent` that selects ONLY which
 * SMS-eligibility rule applies (see its doc comment). It never grants
 * authorization: a VERIFIED challenge still proves nothing but control
 * of the phone, and the consuming endpoints (linking, join requests)
 * each re-derive everything from the challenge row.
 */

/**
 * Request an OTP for member authentication at one gym.
 *
 * Intent selects the SMS-eligibility rule and nothing else:
 * - "link" (the default — absent, "link", or any unrecognized value;
 *   normalization is fail-safe toward the stricter rule): eligibility
 *   (approved V1 definition) is ANY Member row in the organization with
 *   this phone number — an active membership is not required. Ineligible
 *   phones receive no SMS and a synthetic challenge id.
 * - "join" (exactly the string "join"): the caller has declared, before
 *   proving anything, that they want to request membership of this gym.
 *   The member-row check is skipped and any valid phone is issued a real
 *   challenge, so a genuine newcomer can complete verification and
 *   submit a join request. This widens only who can trigger an SMS —
 *   bounded by the same cooldown and per-phone/per-gym caps, which count
 *   challenge rows regardless of intent — and authorizes nothing: the
 *   join endpoint independently re-validates the challenge and decides
 *   whether a request may be created.
 *
 * Either way the response contract is identical: a real challenge id, or
 * a synthetic one when ineligible or rate-limited, so the response never
 * reveals whether the phone belongs to a member of the gym.
 */
export async function requestMemberOtp(input: {
  organizationId: string;
  phoneNumber: string;
  intent?: string;
}): Promise<{ challengeId: string }> {
  // Authoritative phone validation (canonical 10-digit format). Throws
  // MemberValidationError on malformed input — a shape error, safe to
  // surface as a validation response.
  const phoneNumber = validatePhoneNumber(input.phoneNumber);

  if (input.intent !== "join") {
    const member = await db.member.findFirst({
      where: { organizationId: input.organizationId, phoneNumber },
      select: { id: true },
    });
    if (!member) {
      return { challengeId: randomUUID() };
    }
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
      // challenges — on the link path, that it belongs to a member.
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
  // A well-formed code is exactly 6 digits (the application-generated
  // OTP contract). Anything else cannot be the issued code: fail
  // generically without consuming an attempt or touching the challenge.
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

/**
 * Consume a VERIFIED challenge to link the member and create a gym-scoped
 * member session (ADR 021). Delegates to the linking service; the caller
 * (route) sets the session cookie from the returned raw token only after
 * this resolves — i.e. after the linking transaction has committed.
 */
export async function linkMember(input: {
  organizationId: string;
  challengeId: string;
}): Promise<MemberLinkResult> {
  return linkVerifiedChallenge(input);
}

/**
 * Consume a VERIFIED challenge to submit a join request for the gym
 * (onboarding Slice 1). Delegates to the join-request service: the
 * request is created (with its audit event) in the same transaction
 * that claims the challenge, and nothing else — no Member, no
 * Membership, no session — is created. Non-creating outcomes
 * (already pending / already registered) leave the challenge
 * unconsumed.
 */
export async function submitMemberJoinRequest(
  input: SubmitJoinRequestInput,
): Promise<SubmitJoinRequestResult> {
  return submitJoinRequest(input);
}
