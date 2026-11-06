import "server-only";

import { db } from "./db";
import { logServerEvent } from "./logger";

/**
 * Database-backed fixed-window rate-limit buckets (Phase M3a).
 *
 * This store covers abuse ceilings that SPAN tenants — currently OTP
 * requests per client IP. The per-phone and per-organization OTP limits
 * are unchanged and do NOT live here: they keep counting
 * member_otp_challenges rows (ADR 019).
 *
 * Properties:
 * - Atomic: an increment is a single
 *   INSERT … ON CONFLICT DO UPDATE … RETURNING count, so concurrent
 *   requests and multiple application replicas share exact counts
 *   (PostgreSQL serializes on the row). No process-memory state.
 * - Privacy: keys are keyed HMAC hashes produced by client-ip.ts —
 *   never raw IP addresses or phone numbers.
 * - Windows are fixed clock hours (UTC): a bucket covers
 *   [hourStart, hourStart + 1h). Fixed windows can admit up to ~2× the
 *   limit across a boundary, which is acceptable for an abuse ceiling;
 *   the rolling per-phone/per-org caps remain the precise limits.
 *
 * Observation without an admin UI: rows are directly queryable, e.g.
 *   SELECT window_start, count FROM rate_limit_buckets
 *   WHERE kind = 'otp_request_ip' ORDER BY window_start DESC;
 * Counts above OTP_REQUEST_IP_LIMIT_PER_HOUR in shadow mode are the
 * recorded exceedances.
 */

/** Bucket kind for OTP requests keyed by hashed client IP. */
export const OTP_REQUEST_IP_BUCKET_KIND = "otp_request_ip";

/**
 * Candidate ceiling: OTP requests per client IP per fixed hour, across
 * all gyms. NOT production-calibrated — it was sized from the audit
 * (well above a busy gym's shared-Wi-Fi profile, orders of magnitude
 * below a rotation flood) and must be validated against staging
 * observations in shadow mode before enforcement is trusted.
 */
export const OTP_REQUEST_IP_LIMIT_PER_HOUR = 60;

export type RateLimitIpMode = "off" | "shadow" | "enforce";

/**
 * Read RATE_LIMIT_IP_MODE. Default is "shadow" (count and record, never
 * block); unknown values also resolve to "shadow" — a configuration
 * typo must neither silently disable observation nor start blocking.
 */
export function readRateLimitIpMode(): RateLimitIpMode {
  const raw = process.env.RATE_LIMIT_IP_MODE?.trim().toLowerCase();
  if (raw === "off") return "off";
  if (raw === "enforce") return "enforce";
  return "shadow";
}

/** Start of the fixed hour window containing `date`, in UTC. */
export function hourWindowStart(date: Date): Date {
  const window = new Date(date.getTime());
  window.setUTCMinutes(0, 0, 0);
  return window;
}

/** Minimal client surface so tests can drive a second connection pool. */
export interface RateLimitBucketClient {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
}

/**
 * Atomically increment one bucket and return its new count. This is
 * the ONLY write path; the upsert is what makes the count exact under
 * concurrency and across replicas.
 */
export async function incrementRateLimitBucket(input: {
  kind: string;
  keyHash: string;
  now?: Date;
  client?: RateLimitBucketClient;
}): Promise<{ count: number; windowStart: Date }> {
  const client = input.client ?? db;
  const windowStart = hourWindowStart(input.now ?? new Date());
  const rows = await client.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_buckets" ("kind", "key_hash", "window_start", "count", "created_at", "updated_at")
    VALUES (${input.kind}, ${input.keyHash}, ${windowStart}, 1, now(), now())
    ON CONFLICT ("kind", "key_hash", "window_start")
    DO UPDATE SET "count" = "rate_limit_buckets"."count" + 1, "updated_at" = now()
    RETURNING "count"`;
  return { count: rows[0]!.count, windowStart };
}

/** Current count of one bucket (0 when the bucket does not exist). */
export async function getRateLimitBucketCount(input: {
  kind: string;
  keyHash: string;
  now?: Date;
}): Promise<number> {
  const row = await db.rateLimitBucket.findUnique({
    where: {
      kind_keyHash_windowStart: {
        kind: input.kind,
        keyHash: input.keyHash,
        windowStart: hourWindowStart(input.now ?? new Date()),
      },
    },
    select: { count: true },
  });
  return row?.count ?? 0;
}

/**
 * Apply the per-IP OTP request policy for one request.
 *
 * - "off": never counted, always "ok".
 * - "shadow": counted; exceedances are logged and remain queryable in
 *   the bucket rows, but the result is always "ok" — shadow must never
 *   change product behavior, including when the bucket store errors
 *   (the error is logged and counting degrades for that request).
 * - "enforce": counted; "exceeded" once the count passes the ceiling,
 *   and bucket-store errors PROPAGATE (fail closed — the caller
 *   surfaces the same 503 family as other OTP infrastructure failures).
 *
 * The caller folds "exceeded" into the exact same synthetic response
 * as every other non-issuance, so nothing about the outcome is
 * observable to the requester.
 */
export async function checkOtpRequestIpLimit(
  keyHash: string,
): Promise<"ok" | "exceeded"> {
  const mode = readRateLimitIpMode();
  if (mode === "off") {
    return "ok";
  }
  if (mode === "shadow") {
    try {
      const { count } = await incrementRateLimitBucket({
        kind: OTP_REQUEST_IP_BUCKET_KIND,
        keyHash,
      });
      if (count > OTP_REQUEST_IP_LIMIT_PER_HOUR) {
        logServerEvent({
          level: "warn",
          event: "otp_ip_rate_limit_would_exceed",
          boundary: "POST /api/member-auth/otp/request",
        });
      }
    } catch {
      logServerEvent({
        level: "warn",
        event: "otp_ip_rate_limit_bucket_unavailable",
        boundary: "POST /api/member-auth/otp/request",
      });
    }
    return "ok";
  }
  const { count } = await incrementRateLimitBucket({
    kind: OTP_REQUEST_IP_BUCKET_KIND,
    keyHash,
  });
  if (count > OTP_REQUEST_IP_LIMIT_PER_HOUR) {
    logServerEvent({
      level: "warn",
      event: "otp_ip_rate_limit_exceeded",
      boundary: "POST /api/member-auth/otp/request",
    });
    return "exceeded";
  }
  return "ok";
}
