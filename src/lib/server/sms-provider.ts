import "server-only";

/**
 * SMS provider boundary for member OTP (02-USER-FLOWS §9).
 *
 * The OTP is generated, delivered, and verified entirely by the provider:
 * this application never generates an OTP, never stores one, and never logs
 * one. Implementations translate provider-specific mechanics (endpoints,
 * response shapes, credentials) into this interface so the provider can be
 * replaced without touching the OTP service or member-auth layers.
 *
 * Error contract: implementations throw SmsProviderError with a normalized
 * code and a generic message. Upstream error bodies, request URLs, and
 * credentials must NEVER appear in a thrown error (provider URLs can embed
 * API keys), in a log line, or in any client-facing response.
 */
export interface SmsProvider {
  /**
   * Send a provider-generated OTP to the given phone number (canonical
   * 10-digit application format; the implementation adapts it to whatever
   * format the provider expects). Resolves with the provider's session /
   * request identifier, which is stored server-side and used for verify.
   */
  sendOtp(phoneNumber: string): Promise<{ providerSessionId: string }>;

  /**
   * Verify an OTP the user entered against the provider session.
   * A wrong/expired OTP is a normal `{ verified: false }` result, not an
   * error; only infrastructure-level failures throw.
   */
  verifyOtp(
    providerSessionId: string,
    otp: string,
  ): Promise<{ verified: boolean }>;
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
