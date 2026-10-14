import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  POOL_DEFAULTS,
  resolvePoolConfig,
  type PoolEnvSource,
} from "@/lib/server/db";

/**
 * Pool configuration (H1 hardening).
 *
 * The unit block pins the effective configuration — defaults, every
 * environment override, and strict rejection of invalid values — without
 * opening a connection. The database block (RUN_DB_TESTS only) proves
 * the two behaviours that matter operationally against real PostgreSQL:
 * `statement_timeout` cancels an over-running statement server-side, and
 * the pool cap plus `connectionTimeoutMillis` bound acquisition waiting
 * instead of queueing forever.
 */

const CONN = "postgresql://user:pass@localhost:5432/gymsaas";

describe("resolvePoolConfig", () => {
  it("returns the documented defaults when nothing is overridden", () => {
    const config = resolvePoolConfig(CONN, {});
    expect(config.connectionString).toBe(CONN);
    expect(config.max).toBe(POOL_DEFAULTS.max);
    expect(config.connectionTimeoutMillis).toBe(
      POOL_DEFAULTS.connectionTimeoutMillis,
    );
    expect(config.idleTimeoutMillis).toBe(POOL_DEFAULTS.idleTimeoutMillis);
    expect(config.statement_timeout).toBe(POOL_DEFAULTS.statementTimeoutMillis);
  });

  it("honours every environment override", () => {
    const config = resolvePoolConfig(CONN, {
      DB_POOL_MAX: "5",
      DB_POOL_CONNECTION_TIMEOUT_MS: "2500",
      DB_POOL_IDLE_TIMEOUT_MS: "45000",
      DB_STATEMENT_TIMEOUT_MS: "9000",
    });
    expect(config.max).toBe(5);
    expect(config.connectionTimeoutMillis).toBe(2500);
    expect(config.idleTimeoutMillis).toBe(45000);
    expect(config.statement_timeout).toBe(9000);
  });

  it("treats empty values as unset", () => {
    const config = resolvePoolConfig(CONN, { DB_POOL_MAX: "  " });
    expect(config.max).toBe(POOL_DEFAULTS.max);
  });

  it.each([
    ["DB_POOL_MAX", "0"],
    ["DB_POOL_MAX", "51"],
    ["DB_POOL_MAX", "eight"],
    ["DB_POOL_MAX", "2.5"],
    ["DB_POOL_MAX", "-3"],
    ["DB_POOL_CONNECTION_TIMEOUT_MS", "99"],
    ["DB_POOL_CONNECTION_TIMEOUT_MS", "60001"],
    ["DB_POOL_IDLE_TIMEOUT_MS", "999"],
    ["DB_STATEMENT_TIMEOUT_MS", "0"],
    ["DB_STATEMENT_TIMEOUT_MS", "soon"],
  ])("rejects an invalid %s=%s at startup", (name, value) => {
    expect(() => resolvePoolConfig(CONN, { [name]: value })).toThrow(
      new RegExp(`Invalid ${name}`),
    );
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "pool behaviour against real PostgreSQL",
  () => {
    const databaseUrl = process.env.DATABASE_URL as string;

    function clientWith(source: PoolEnvSource) {
      return new PrismaClient({
        adapter: new PrismaPg(resolvePoolConfig(databaseUrl, source)),
      });
    }

    const timeoutClient = clientWith({ DB_STATEMENT_TIMEOUT_MS: "400" });
    const poolClient = clientWith({
      DB_POOL_MAX: "2",
      DB_POOL_CONNECTION_TIMEOUT_MS: "300",
      DB_STATEMENT_TIMEOUT_MS: "10000",
    });

    afterAll(async () => {
      await timeoutClient.$disconnect();
      await poolClient.$disconnect();
    });

    it("cancels a statement that exceeds statement_timeout, server-side", async () => {
      const started = Date.now();
      let error: unknown;
      try {
        await timeoutClient.$executeRaw`SELECT pg_sleep(2)`;
      } catch (e) {
        error = e;
      }
      const elapsed = Date.now() - started;
      expect(error).toBeDefined();
      expect(String(error)).toMatch(/statement timeout/i);
      // Cancelled near the 400 ms limit, not after the full 2 s sleep.
      expect(elapsed).toBeLessThan(1_900);
    });

    it("bounds pool-acquisition waiting at the configured cap", async () => {
      // $executeRaw: pg_sleep returns void, which $queryRaw cannot
      // deserialize — the sleeps only need to hold their connections.
      // Async IIFEs: Prisma promises are lazy and would not start (or
      // hold a connection) until awaited without them.
      const first = (async () =>
        poolClient.$executeRaw`SELECT pg_sleep(1.5)`)();
      const second = (async () =>
        poolClient.$executeRaw`SELECT pg_sleep(1.5)`)();
      // Give both sleeps a moment to check out the pool's two slots.
      await new Promise((resolve) => setTimeout(resolve, 150));
      let error: unknown;
      try {
        await poolClient.$queryRaw`SELECT 1`;
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect(String(error)).toMatch(/timeout/i);
      await Promise.all([first, second]);
      // The pool recovers once the holders finish.
      await expect(poolClient.$queryRaw`SELECT 1`).resolves.toBeDefined();
    });

    it("applies the default statement_timeout on the shared app client", async () => {
      if (process.env.DB_STATEMENT_TIMEOUT_MS) return;
      const { db } = await import("@/lib/server/db");
      const rows = await db.$queryRaw<{ statement_timeout: string }[]>`
        SHOW statement_timeout
      `;
      expect(rows[0]?.statement_timeout).toBe("15s");
    });
  },
);
