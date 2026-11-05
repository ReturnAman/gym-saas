import "server-only";

/**
 * SMS provider boundary for member OTP (02-USER-FLOWS §9).
 *
 * The provider is responsible ONLY for delivering an OTP the application
 * has generated. Generation and verification are application-owned (see
 * otp-service.ts and otp-crypto.ts): the application generates the code,
 * stores only a keyed HMAC digest of it, and verifies entries locally.
 * The provider never sees a verification request and returns nothing the
 * application depends on — a delivery acknowledgement is not a session.
 *
 * Implementations translate provider-specific mechanics (endpoints,
 * request/response shapes, credentials) into this interface so the
 * delivery provider can be replaced without touching the OTP service or
 * member-auth layers.
 *
 * Error contract: implementations throw SmsProviderError with a
 * normalized code and a generic message. Upstream error bodies, request
 * bodies, credentials, and OTPs must NEVER appear in a thrown error, in
 * a log line, or in any client-facing response.
 */
export interface SmsProvider {
  /**
   * Deliver the given application-generated OTP to the given phone
   * number (canonical 10-digit application format; the implementation
   * adapts it to whatever format the provider expects). Resolves once
   * the provider has accepted the message for delivery; throws
   * SmsProviderError on any failure.
   */
  sendOtp(phoneNumber: string, otp: string): Promise<void>;
}

export type SmsProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "NOT_CONFIGURED";

/** Normalized provider failure. Messages are generic by construction. */
export class SmsProviderError extends Error {
  code: SmsProviderErrorCode;

  constructor(code: SmsProviderErrorCode) {
    super(
      code === "NOT_CONFIGURED"
        ? "SMS provider is not configured."
        : code === "PROVIDER_REJECTED"
          ? "SMS provider rejected the request."
          : "SMS provider is unavailable.",
    );
    this.name = "SmsProviderError";
    this.code = code;
  }
}
