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
 *
 * Retention (Phase M3a.1): bucket rows are deleted once their window
 * is more than RATE_LIMIT_BUCKET_RETENTION_DAYS old — see the cleanup
 * section below. This retention applies ONLY to these counters; OTP
 * challenges (member_otp_challenges) have their own lifecycle and are
 * never touched by bucket cleanup.
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
  // Opportunistic bucket retention (Phase M3a.1). Guarded to one
  // attempt per hour per process, coordinated across replicas by an
  // advisory try-lock, and internally failure-swallowing: it can
  // never block or break the check it rides along with.
  await maybeCleanupExpiredRateLimitBuckets();
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

/**
 * --------------------------------------------------------------------
 * Bucket retention cleanup (Phase M3a.1)
 * --------------------------------------------------------------------
 * The project has no scheduler or cron infrastructure, so cleanup is
 * OPPORTUNISTIC: it rides along with OTP requests (see
 * checkOtpRequestIpLimit), guarded to one attempt per hour per
 * process, and coordinated across replicas by a PostgreSQL advisory
 * TRY-lock — at most one cleaner runs at a time, and a request that
 * finds the lock held simply skips. There is no in-process timer and
 * no cleanup endpoint.
 *
 * Safety properties:
 * - Only windows older than the retention cutoff are deleted; the
 *   current window — the only one enforcement ever reads — is never
 *   touched, so cleanup cannot weaken an active limit.
 * - Every batch is a single bounded DELETE (at most
 *   RATE_LIMIT_CLEANUP_BATCH_SIZE rows) in its own short transaction;
 *   a run is capped at RATE_LIMIT_CLEANUP_MAX_BATCHES batches. There
 *   is no unbounded delete.
 * - Cleanup is idempotent and failure-isolated: errors are logged
 *   (structure only — never keys, addresses, or counts in the log
 *   line) and swallowed by the opportunistic wrapper, so OTP issuance
 *   proceeds exactly as if cleanup had not run. Lag is observable
 *   via getOldestRateLimitBucketStart() or SQL:
 *     SELECT min(window_start) FROM rate_limit_buckets;
 *
 * Index note (measured 2026-11-06): the primary key
 * (kind, key_hash, window_start) cannot range-scan window_start, so
 * each batch scans the table to find expired rows. On a seeded
 * 120,000-row table (~69,000 expired — roughly 100× the pilot's
 * expected working set) one 1,000-row batch took ~79 ms. With hourly
 * runs and a seven-day working set the table is self-limiting, so no
 * additional index is justified now. Revisit if the table approaches
 * ~1M rows or a batch scan sustains > ~250 ms: the candidate fix is
 * an index on (kind, window_start) in a forward-only migration.
 */

/** Days of bucket history retained. Buckets only — NOT OTP challenges. */
export const RATE_LIMIT_BUCKET_RETENTION_DAYS = 7;
/** Rows deleted per batch statement. */
export const RATE_LIMIT_CLEANUP_BATCH_SIZE = 1_000;
/** Batches per cleanup run, bounding one run's total work. */
export const RATE_LIMIT_CLEANUP_MAX_BATCHES = 5;
/** Minimum gap between opportunistic cleanup attempts, per process. */
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 60_000;

const CLEANUP_LOCK_KEY = "rate-limit-bucket-cleanup";

/**
 * The retention cutoff for `now`: the start of the hour seven days
 * earlier. Buckets with window_start strictly before this instant are
 * expired; a bucket exactly AT the cutoff is retained. Because bucket
 * windows are hour-aligned, the cutoff is too — no partial window is
 * ever cut.
 */
export function bucketRetentionCutoff(now: Date): Date {
  const cutoff = hourWindowStart(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - RATE_LIMIT_BUCKET_RETENTION_DAYS);
  return cutoff;
}

/**
 * Delete expired buckets in bounded, lock-coordinated batches.
 *
 * Each batch runs in its own transaction guarded by
 * pg_try_advisory_xact_lock: if another cleaner (any replica) holds
 * the lock, the run stops without deleting — lock contention is a
 * normal outcome, not an error. Batch deletes target disjoint,
 * expired primary-key ranges, so they do not block current-window
 * upserts beyond ordinary row-lock scope (expired rows only).
 *
 * Returns what the run did; lockAcquired is false when another
 * cleaner held the lock for the first batch.
 */
export async function cleanupExpiredRateLimitBuckets(input?: {
  now?: Date;
}): Promise<{ deleted: number; batches: number; lockAcquired: boolean }> {
  const cutoff = bucketRetentionCutoff(input?.now ?? new Date());
  let deleted = 0;
  let batches = 0;
  let lockAcquired = false;

  for (let i = 0; i < RATE_LIMIT_CLEANUP_MAX_BATCHES; i += 1) {
    const batchDeleted = await db.$transaction(async (tx) => {
      const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${CLEANUP_LOCK_KEY})) AS locked`;
      if (!lockRows[0]?.locked) {
        return -1;
      }
      return tx.$executeRaw`
        DELETE FROM "rate_limit_buckets"
        WHERE ("kind", "key_hash", "window_start") IN (
          SELECT "kind", "key_hash", "window_start"
          FROM "rate_limit_buckets"
          WHERE "window_start" < ${cutoff}
          ORDER BY "window_start" ASC
          LIMIT ${RATE_LIMIT_CLEANUP_BATCH_SIZE}
        )`;
    });
    if (batchDeleted < 0) {
      break;
    }
    lockAcquired = true;
    batches += 1;
    deleted += batchDeleted;
    if (batchDeleted < RATE_LIMIT_CLEANUP_BATCH_SIZE) {
      break;
    }
  }
  return { deleted, batches, lockAcquired };
}

let lastCleanupAttemptAtMs = 0;

/**
 * Opportunistic entry point: at most one cleanup attempt per
 * RATE_LIMIT_CLEANUP_INTERVAL_MS per process (the timestamp is taken
 * BEFORE the attempt, so a failing cleanup cannot retry on every
 * request). Never throws — failures are logged and forgotten until
 * the next interval.
 */
export async function maybeCleanupExpiredRateLimitBuckets(
  now: Date = new Date(),
): Promise<void> {
  const nowMs = now.getTime();
  if (nowMs - lastCleanupAttemptAtMs < RATE_LIMIT_CLEANUP_INTERVAL_MS) {
    return;
  }
  lastCleanupAttemptAtMs = nowMs;
  try {
    const result = await cleanupExpiredRateLimitBuckets({ now });
    if (result.deleted > 0) {
      logServerEvent({
        level: "info",
        event: "rate_limit_bucket_cleanup_completed",
        boundary: "otp:request",
      });
    }
  } catch {
    logServerEvent({
      level: "warn",
      event: "rate_limit_bucket_cleanup_failed",
      boundary: "otp:request",
    });
  }
}

/** Oldest retained bucket window, or null when the table is empty. */
export async function getOldestRateLimitBucketStart(): Promise<Date | null> {
  const row = await db.rateLimitBucket.findFirst({
    orderBy: { windowStart: "asc" },
    select: { windowStart: true },
  });
  return row?.windowStart ?? null;
}
