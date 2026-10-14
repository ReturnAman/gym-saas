// Classification of database failures (H2 hardening).
//
// Services and actions throw whatever Prisma 7 / the pg driver produce.
// Until now every database failure fell into the same generic bucket as
// any unexpected error, which is wrong in two directions: a transient
// outage deserves a "temporarily unavailable" response (503 in API
// routes), and — for writes — a lost connection is NOT proof that the
// operation rolled back. This module classifies ONLY the failure shapes
// this stack demonstrably produces (Prisma's documented connectivity
// codes, the pg driver's own messages, and PostgreSQL SQLSTATEs, seen
// through the driver adapter's error chain). Anything unrecognized
// returns null and callers keep their existing behaviour — unknown
// exceptions are never relabelled as outages.
//
// The three kinds differ in what a caller may promise the user:
//
// - "connection": the database could not be reached, or the connection
//   died mid-operation. A write in flight MAY have committed before the
//   failure (the commit acknowledgement can be the thing that was
//   lost), so money-writing callers must not say "not saved": they tell
//   the user to check the persisted state first (see mayHaveCommitted).
// - "pool-timeout": no connection was ever acquired (pg: "timeout
//   exceeded when trying to connect"; Prisma: P2024). The operation
//   definitely did not run.
// - "statement-timeout": PostgreSQL cancelled the statement itself
//   (SQLSTATE 57014, via the H1 statement_timeout). Inside a
//   transaction this aborts it — the operation definitely did not
//   commit.

import { Prisma } from "@prisma/client";

export type DatabaseErrorKind =
  | "connection"
  | "pool-timeout"
  | "statement-timeout";

/** Prisma codes for "the database is not reachable / the link died". */
const CONNECTION_PRISMA_CODES = new Set(["P1001", "P1002", "P1017"]);

/** PostgreSQL SQLSTATEs for connection loss / admin shutdown. */
const CONNECTION_SQLSTATES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
]);

/** Node.js network error codes seen on dead/refused connections. */
const CONNECTION_ERRNO_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
]);

function* errorChain(error: unknown): Generator<unknown> {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth++) {
    yield current;
    if (typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    // Driver-adapter errors nest the pg error under meta.driverAdapterError
    // and/or cause; walk both.
    const next = record.cause ?? record.meta;
    if (next && typeof next === "object") {
      const meta = next as Record<string, unknown>;
      current = meta.driverAdapterError ?? next;
    } else {
      return;
    }
  }
}

function classifyNode(node: unknown): DatabaseErrorKind | null {
  if (node instanceof Prisma.PrismaClientInitializationError) {
    return "connection";
  }
  if (typeof node !== "object" || node === null) return null;
  const record = node as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : null;
  if (code === "57014") return "statement-timeout";
  if (code === "P2024") return "pool-timeout";
  if (code && CONNECTION_PRISMA_CODES.has(code)) return "connection";
  if (code && CONNECTION_SQLSTATES.has(code)) return "connection";
  if (code && CONNECTION_ERRNO_CODES.has(code)) return "connection";
  const message = node instanceof Error ? node.message : null;
  if (message) {
    if (/canceling statement due to statement timeout/i.test(message)) {
      return "statement-timeout";
    }
    if (/timeout exceeded when trying to connect/i.test(message)) {
      return "pool-timeout";
    }
    if (/connection terminated/i.test(message)) return "connection";
    if (/terminating connection due to administrator command/i.test(message)) {
      return "connection";
    }
  }
  return null;
}

/**
 * Classify an unknown thrown value as a database failure kind, or null
 * when it is not a recognized database failure.
 */
export function classifyDatabaseError(
  error: unknown,
): DatabaseErrorKind | null {
  for (const node of errorChain(error)) {
    const kind = classifyNode(node);
    if (kind) return kind;
  }
  return null;
}

/**
 * True when a failed WRITE may nevertheless have committed: the failure
 * is a connection loss, which can strike after the commit but before
 * its acknowledgement returned. Callers must not promise "not saved"
 * for these — they direct the user to the persisted state instead.
 * Pool and statement timeouts are definite non-commits and return
 * false here.
 */
export function mayHaveCommitted(error: unknown): boolean {
  return classifyDatabaseError(error) === "connection";
}

/** Shared API-route body for a database failure (HTTP 503). */
export const DATABASE_UNAVAILABLE_BODY = {
  error: {
    code: "DATABASE_UNAVAILABLE",
    message: "The service is temporarily unavailable. Please try again shortly.",
  },
} as const;

/** Action message for a definite database failure (safe to retry). */
export const DATABASE_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "The database is temporarily unavailable. Please try again in a moment.";
