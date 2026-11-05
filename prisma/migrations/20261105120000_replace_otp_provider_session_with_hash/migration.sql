-- Replace provider-managed OTP verification with application-managed
-- verification (APITxT delivers the SMS; the application generates the
-- OTP and verifies it against a stored keyed HMAC digest).

-- Add the OTP verifier digest. Nullable so historical rows remain
-- representable; newly issued challenges always carry a digest.
ALTER TABLE "member_otp_challenges" ADD COLUMN "otp_hash" TEXT;

-- Invalidate outstanding challenges issued under the old provider
-- model: they carry no digest and can never verify locally, so retire
-- them instead of leaving them PENDING until expiry.
UPDATE "member_otp_challenges" SET "status" = 'SUPERSEDED' WHERE "status" = 'PENDING';

-- Drop the obsolete provider session identifier.
ALTER TABLE "member_otp_challenges" DROP COLUMN "provider_session_id";
