-- Fixed-window rate-limit counters (Phase M3a). Keys are HMAC hashes —
-- never raw IP addresses or phone numbers. The composite primary key is
-- the only index; the per-phone/per-organization OTP limits continue to
-- count member_otp_challenges rows and do not use this table.
CREATE TABLE "rate_limit_buckets" (
    "kind" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("kind", "key_hash", "window_start")
);
