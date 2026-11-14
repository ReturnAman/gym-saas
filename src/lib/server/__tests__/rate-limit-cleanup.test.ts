import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockQueryRaw,
  mockBucketFindFirst,
  mockTransaction,
  mockTxQueryRaw,
  mockTxExecuteRaw,
} = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockBucketFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxQueryRaw: vi.fn(),
  mockTxExecuteRaw: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    $queryRaw: mockQueryRaw,
    $transaction: mockTransaction,
    rateLimitBucket: { findFirst: mockBucketFindFirst },
  },
}));

import {
  RATE_LIMIT_CLEANUP_BATCH_SIZE,
  RATE_LIMIT_CLEANUP_MAX_BATCHES,
  bucketRetentionCutoff,
  cleanupExpiredRateLimitBuckets,
  getOldestRateLimitBucketStart,
  maybeCleanupExpiredRateLimitBuckets,
} from "@/lib/server/rate-limit";

/**
 * Retention cleanup, unit level. Kept in its own file so the
 * module-level opportunistic guard state starts fresh: the guard
 * tests inject times in 2027, beyond any real-clock attempt another
 * suite could have made.
 */
const NOW = new Date("2026-11-06T10:59:59.999Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockTxQueryRaw.mockResolvedValue([{ locked: true }]);
  mockTxExecuteRaw.mockResolvedValue(0);
  mockTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: mockTxQueryRaw, $executeRaw: mockTxExecuteRaw }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bucketRetentionCutoff", () => {
  it("is the hour floor exactly seven days earlier (UTC)", () => {
    expect(bucketRetentionCutoff(NOW).toISOString()).toBe("2026-10-30T10:00:00.000Z");
    expect(bucketRetentionCutoff(new Date("2026-11-06T00:00:00.000Z")).toISOString()).toBe(
      "2026-10-30T00:00:00.000Z",
    );
    // Month boundary: March 3 minus seven days lands on February 24.
    expect(bucketRetentionCutoff(new Date("2026-03-03T05:30:00.000Z")).toISOString()).toBe(
      "2026-02-24T05:00:00.000Z",
    );
  });
});

describe("cleanupExpiredRateLimitBuckets", () => {
  it("deletes in bounded batches until a short batch ends the run", async () => {
    mockTxExecuteRaw
      .mockResolvedValueOnce(RATE_LIMIT_CLEANUP_BATCH_SIZE)
      .mockResolvedValueOnce(RATE_LIMIT_CLEANUP_BATCH_SIZE)
      .mockResolvedValueOnce(300);
    const result = await cleanupExpiredRateLimitBuckets({ now: NOW });
    expect(result).toEqual({ deleted: 2_300, batches: 3, lockAcquired: true });
    expect(mockTxExecuteRaw).toHaveBeenCalledTimes(3);
  });

  it("caps a run at the maximum batch count even when every batch is full", async () => {
    mockTxExecuteRaw.mockResolvedValue(RATE_LIMIT_CLEANUP_BATCH_SIZE);
    const result = await cleanupExpiredRateLimitBuckets({ now: NOW });
    expect(result.batches).toBe(RATE_LIMIT_CLEANUP_MAX_BATCHES);
    expect(result.deleted).toBe(
      RATE_LIMIT_CLEANUP_BATCH_SIZE * RATE_LIMIT_CLEANUP_MAX_BATCHES,
    );
  });

  it("issues the bounded delete with the retention cutoff as a bound value", async () => {
    await cleanupExpiredRateLimitBuckets({ now: NOW });
    const [strings, ...values] = mockTxExecuteRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join("?");
    expect(sql).toContain('DELETE FROM "rate_limit_buckets"');
    expect(sql).toContain('"window_start" <');
    expect(sql).toContain("LIMIT");
    expect(values).toContainEqual(bucketRetentionCutoff(NOW));
    expect(values).toContain(RATE_LIMIT_CLEANUP_BATCH_SIZE);
  });

  it("takes the advisory try-lock before deleting", async () => {
    await cleanupExpiredRateLimitBuckets({ now: NOW });
    const lockSql = (mockTxQueryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
    expect(lockSql).toContain("pg_try_advisory_xact_lock");
    expect(mockTxQueryRaw.mock.invocationCallOrder[0]!).toBeLessThan(
      mockTxExecuteRaw.mock.invocationCallOrder[0]!,
    );
  });

  it("skips deletion entirely when another cleaner holds the lock", async () => {
    mockTxQueryRaw.mockResolvedValue([{ locked: false }]);
    const result = await cleanupExpiredRateLimitBuckets({ now: NOW });
    expect(result).toEqual({ deleted: 0, batches: 0, lockAcquired: false });
    expect(mockTxExecuteRaw).not.toHaveBeenCalled();
  });

  it("propagates store failures to its caller (the wrapper isolates them)", async () => {
    mockTransaction.mockRejectedValue(new Error("fixture db failure"));
    await expect(cleanupExpiredRateLimitBuckets({ now: NOW })).rejects.toThrow(
      "fixture db failure",
    );
  });
});

describe("maybeCleanupExpiredRateLimitBuckets", () => {
  const T0 = new Date("2027-06-01T00:00:00.000Z");

  it("runs at most once per interval per process", async () => {
    await maybeCleanupExpiredRateLimitBuckets(T0);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    await maybeCleanupExpiredRateLimitBuckets(
      new Date(T0.getTime() + 30 * 60_000),
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    await maybeCleanupExpiredRateLimitBuckets(
      new Date(T0.getTime() + 61 * 60_000),
    );
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it("never throws, even when the cleanup itself fails", async () => {
    mockTransaction.mockRejectedValue(new Error("fixture db failure"));
    await expect(
      maybeCleanupExpiredRateLimitBuckets(new Date("2027-07-01T00:00:00.000Z")),
    ).resolves.toBeUndefined();
  });
});

describe("getOldestRateLimitBucketStart", () => {
  it("returns the oldest window or null for an empty table", async () => {
    const oldest = new Date("2026-11-01T10:00:00.000Z");
    mockBucketFindFirst.mockResolvedValue({ windowStart: oldest });
    await expect(getOldestRateLimitBucketStart()).resolves.toBe(oldest);
    mockBucketFindFirst.mockResolvedValue(null);
    await expect(getOldestRateLimitBucketStart()).resolves.toBeNull();
  });
});
