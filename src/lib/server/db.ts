// Single shared PrismaClient for the Next.js server.
//
// A new client per request (or per hot-reload, or per module-graph
// evaluation in production) exhausts the database connection pool,
// so the client is cached on globalThis in every environment.
// This module is server-only: never import it from client components.
//
// Prisma 7 connects through a driver adapter (see prisma.config.ts for the
// CLI-side datasource configuration). The adapter hands the pool config
// object below to `pg.Pool` verbatim (@prisma/adapter-pg 7.10.0), so the
// option names and semantics are exactly node-postgres' (pg 8.23):
//
// - `max`: hard cap on simultaneous connections this instance may open.
// - `connectionTimeoutMillis`: how long a query may WAIT for a free
//   connection before failing. This bounds pool-acquisition waiting only;
//   it says nothing about a query already running.
// - `idleTimeoutMillis`: how long an idle connection is kept before the
//   pool closes it.
// - `statement_timeout`: a server-side PostgreSQL limit applied to every
//   connection in the pool — a statement running longer than this is
//   cancelled by PostgreSQL itself (error 57014). This is the mechanism
//   that bounds query execution; it is NOT a client-side timer.
//
// Connection budget (provisional — final hosting is not yet decided, so
// the defaults are sized against the smallest verified provider cap, the
// 20-connection entry tier assessed for the pilot):
//
//   web instance pool (this config)        8
//   release / migration process           ~2   (Prisma CLI connects via
//                                              prisma.config.ts, not
//                                              through this pool)
//   operational access (console / psql)   ~2
//   total                                ~12 of 20, leaving headroom
//
// A second web instance at max=8 would consume the entire budget of a
// 20-connection plan: scale instances only together with a database
// tier increase or a lower DB_POOL_MAX. All four values can be tuned
// per environment through the optional variables below; invalid values
// fail fast at startup rather than silently falling back.

import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { env } from "./env";

export const POOL_DEFAULTS = {
  max: 8,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statementTimeoutMillis: 15_000,
} as const;

const POOL_LIMITS = {
  DB_POOL_MAX: { min: 1, max: 50 },
  DB_POOL_CONNECTION_TIMEOUT_MS: { min: 100, max: 60_000 },
  DB_POOL_IDLE_TIMEOUT_MS: { min: 1_000, max: 600_000 },
  DB_STATEMENT_TIMEOUT_MS: { min: 100, max: 300_000 },
} as const;

type PoolEnvName = keyof typeof POOL_LIMITS;

/** Only the four pool variables are read; anything else is ignored. */
export type PoolEnvSource = { [key: string]: string | undefined };

function parsePoolInteger(
  name: PoolEnvName,
  raw: string | undefined,
  defaultValue: number,
): number {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const { min, max } = POOL_LIMITS[name];
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(
      `Invalid ${name}: ${JSON.stringify(raw)}. ` +
        `Expected an integer between ${min} and ${max}.`,
    );
  }
  const value = Number(raw.trim());
  if (value < min || value > max) {
    throw new Error(
      `Invalid ${name}: ${value}. Expected an integer between ${min} and ${max}.`,
    );
  }
  return value;
}

/**
 * Resolve the effective PostgreSQL pool configuration for this instance.
 * Exported for tests: the defaults and every override are asserted
 * without opening a connection.
 */
export function resolvePoolConfig(
  connectionString: string,
  source: PoolEnvSource = process.env,
): PoolConfig {
  return {
    connectionString,
    max: parsePoolInteger("DB_POOL_MAX", source.DB_POOL_MAX, POOL_DEFAULTS.max),
    connectionTimeoutMillis: parsePoolInteger(
      "DB_POOL_CONNECTION_TIMEOUT_MS",
      source.DB_POOL_CONNECTION_TIMEOUT_MS,
      POOL_DEFAULTS.connectionTimeoutMillis,
    ),
    idleTimeoutMillis: parsePoolInteger(
      "DB_POOL_IDLE_TIMEOUT_MS",
      source.DB_POOL_IDLE_TIMEOUT_MS,
      POOL_DEFAULTS.idleTimeoutMillis,
    ),
    statement_timeout: parsePoolInteger(
      "DB_STATEMENT_TIMEOUT_MS",
      source.DB_STATEMENT_TIMEOUT_MS,
      POOL_DEFAULTS.statementTimeoutMillis,
    ),
  };
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const adapter = new PrismaPg(resolvePoolConfig(env.databaseUrl));

export const db: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

globalForPrisma.prisma = db;
