import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockQueryRaw,
  mockBucketFindUnique,
  mockBucketFindFirst,
  mockTransaction,
  mockTxQueryRaw,
  mockTxExecuteRaw,
} = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockBucketFindUnique: vi.fn(),
  mockBucketFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxQueryRaw: vi.fn(),
  mockTxExecuteRaw: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    $queryRaw: mockQueryRaw,
    $transaction: mockTransaction,
    rateLimitBucket: {
      findUnique: mockBucketFindUnique,
      findFirst: mockBucketFindFirst,
    },
  },
}));

import {
  OTP_REQUEST_IP_LIMIT_PER_HOUR,
  checkOtpRequestIpLimit,
  getRateLimitBucketCount,
  hourWindowStart,
  incrementRateLimitBucket,
  readRateLimitIpMode,
} from "@/lib/server/rate-limit";

const KEY_HASH = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  // Cleanup plumbing defaults: the advisory try-lock is free and a
  // batch deletes nothing. Individual tests override as needed.
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

describe("hourWindowStart", () => {
  it("floors to the UTC hour", () => {
    expect(hourWindowStart(new Date("2026-11-06T10:59:59.999Z")).toISOString()).toBe(
      "2026-11-06T10:00:00.000Z",
    );
    expect(hourWindowStart(new Date("2026-11-06T10:00:00.000Z")).toISOString()).toBe(
      "2026-11-06T10:00:00.000Z",
    );
    expect(hourWindowStart(new Date("2026-11-06T00:30:00.000Z")).toISOString()).toBe(
      "2026-11-06T00:00:00.000Z",
    );
    expect(hourWindowStart(new Date("2026-11-06T23:15:00.000Z")).toISOString()).toBe(
      "2026-11-06T23:00:00.000Z",
    );
  });

  it("does not mutate its input", () => {
    const input = new Date("2026-11-06T10:59:59.999Z");
    hourWindowStart(input);
    expect(input.toISOString()).toBe("2026-11-06T10:59:59.999Z");
  });
});

describe("readRateLimitIpMode", () => {
  it("defaults to shadow when unset", () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "");
    expect(readRateLimitIpMode()).toBe("shadow");
  });

  it("parses the three modes case-insensitively", () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "off");
    expect(readRateLimitIpMode()).toBe("off");
    vi.stubEnv("RATE_LIMIT_IP_MODE", "SHADOW");
    expect(readRateLimitIpMode()).toBe("shadow");
    vi.stubEnv("RATE_LIMIT_IP_MODE", "Enforce");
    expect(readRateLimitIpMode()).toBe("enforce");
  });

  it("resolves unknown values to shadow (never silently off, never blocking by typo)", () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "banana");
    expect(readRateLimitIpMode()).toBe("shadow");
  });
});

describe("incrementRateLimitBucket", () => {
  it("issues one atomic upsert and returns the new count with the floored window", async () => {
    mockQueryRaw.mockResolvedValue([{ count: 7 }]);
    const result = await incrementRateLimitBucket({
      kind: "otp_request_ip",
      keyHash: KEY_HASH,
      now: new Date("2026-11-06T10:59:59.999Z"),
    });
    expect(result.count).toBe(7);
    expect(result.windowStart.toISOString()).toBe("2026-11-06T10:00:00.000Z");

    const [strings, ...values] = mockQueryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join("?");
    expect(sql).toContain('INSERT INTO "rate_limit_buckets"');
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain('DO UPDATE SET "count" = "rate_limit_buckets"."count" + 1');
    expect(sql).toContain('RETURNING "count"');
    expect(values).toContain("otp_request_ip");
    expect(values).toContain(KEY_HASH);
  });
});

describe("getRateLimitBucketCount", () => {
  it("reads the current window's count, defaulting to 0", async () => {
    mockBucketFindUnique.mockResolvedValue({ count: 3 });
    await expect(
      getRateLimitBucketCount({ kind: "otp_request_ip", keyHash: KEY_HASH }),
    ).resolves.toBe(3);
    mockBucketFindUnique.mockResolvedValue(null);
    await expect(
      getRateLimitBucketCount({ kind: "otp_request_ip", keyHash: KEY_HASH }),
    ).resolves.toBe(0);
  });
});

describe("checkOtpRequestIpLimit", () => {
  it("off: never counts and always allows", async () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "off");
    await expect(checkOtpRequestIpLimit(KEY_HASH)).resolves.toBe("ok");
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("shadow: counts but never blocks, even past the ceiling", async () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "shadow");
    mockQueryRaw.mockResolvedValue([{ count: OTP_REQUEST_IP_LIMIT_PER_HOUR + 25 }]);
    await expect(checkOtpRequestIpLimit(KEY_HASH)).resolves.toBe("ok");
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("shadow: a bucket-store failure degrades counting, never the request", async () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "shadow");
    mockQueryRaw.mockRejectedValue(new Error("fixture db failure"));
    await expect(checkOtpRequestIpLimit(KEY_HASH)).resolves.toBe("ok");
  });

  it("enforce: allows up to the ceiling and blocks past it", async () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "enforce");
    mockQueryRaw.mockResolvedValue([{ count: OTP_REQUEST_IP_LIMIT_PER_HOUR }]);
    await expect(checkOtpRequestIpLimit(KEY_HASH)).resolves.toBe("ok");
    mockQueryRaw.mockResolvedValue([{ count: OTP_REQUEST_IP_LIMIT_PER_HOUR + 1 }]);
    await expect(checkOtpRequestIpLimit(KEY_HASH)).resolves.toBe("exceeded");
  });

  it("enforce: a bucket-store failure propagates (fail closed)", async () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "enforce");
    mockQueryRaw.mockRejectedValue(new Error("fixture db failure"));
    await expect(checkOtpRequestIpLimit(KEY_HASH)).rejects.toThrow(
      "fixture db failure",
    );
  });
});

describe("rate_limit_buckets schema coherence", () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
  const schema = readFileSync(path.join(repoRoot, "prisma/schema.prisma"), "utf8");
  const migrationSql = readFileSync(
    path.join(
      repoRoot,
      "prisma/migrations/20261106120000_add_rate_limit_buckets/migration.sql",
    ),
    "utf8",
  );

  it("the model and the migration agree on the composite key", () => {
    expect(schema).toMatch(/model RateLimitBucket/);
    expect(schema).toMatch(/@@id\(\[kind, keyHash, windowStart\]\)/);
    expect(schema).toMatch(/@@map\("rate_limit_buckets"\)/);
    expect(migrationSql).toMatch(/CREATE TABLE "rate_limit_buckets"/);
    expect(migrationSql).toMatch(
      /PRIMARY KEY \("kind", "key_hash", "window_start"\)/,
    );
  });
});
