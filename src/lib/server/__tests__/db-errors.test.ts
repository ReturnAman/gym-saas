import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import {
  classifyDatabaseError,
  mayHaveCommitted,
} from "@/lib/server/db-errors";
import { PaymentValidationError } from "@/lib/members";

/**
 * Database-failure classification (H2). The shapes below mirror what
 * this stack actually produces, verified against Prisma 7.10 +
 * @prisma/adapter-pg + pg 8.23:
 *
 * - an unreachable server surfaces as PrismaClientKnownRequestError
 *   P1001 ("Can't reach database server"), with the adapter error under
 *   meta.driverAdapterError;
 * - a statement_timeout cancellation carries SQLSTATE 57014 and the
 *   text "canceling statement due to statement timeout" in the chain;
 * - a pg pool-acquisition timeout reads "timeout exceeded when trying
 *   to connect" in the chain.
 */

function knownError(code: string, message = "db failure") {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: "7.10.0",
  });
}

describe("classifyDatabaseError", () => {
  it("classifies an unreachable database (P1001) as a connection failure", () => {
    const error = knownError("P1001", "Can't reach database server at db:5432");
    expect(classifyDatabaseError(error)).toBe("connection");
    expect(mayHaveCommitted(error)).toBe(true);
  });

  it("classifies P1002 and P1017 as connection failures", () => {
    expect(classifyDatabaseError(knownError("P1002"))).toBe("connection");
    expect(classifyDatabaseError(knownError("P1017"))).toBe("connection");
  });

  it("classifies a PrismaClientInitializationError as a connection failure", () => {
    const error = new Prisma.PrismaClientInitializationError(
      "Can't reach database server",
      "7.10.0",
    );
    expect(classifyDatabaseError(error)).toBe("connection");
  });

  it("classifies a statement timeout nested in the adapter chain", () => {
    const pgError = new Error(
      "canceling statement due to statement timeout",
    ) as Error & { code?: string };
    pgError.code = "57014";
    const wrapped = new Error("Raw query failed.") as Error & {
      meta?: unknown;
    };
    wrapped.meta = { driverAdapterError: pgError };
    expect(classifyDatabaseError(wrapped)).toBe("statement-timeout");
    expect(mayHaveCommitted(wrapped)).toBe(false);
  });

  it("classifies a bare SQLSTATE 57014 as a statement timeout", () => {
    const error = new Error("query failed") as Error & { code?: string };
    error.code = "57014";
    expect(classifyDatabaseError(error)).toBe("statement-timeout");
  });

  it("classifies the pg pool-acquisition timeout in a cause chain", () => {
    const error = new Error("Failed to acquire a connection", {
      cause: new Error("timeout exceeded when trying to connect"),
    });
    expect(classifyDatabaseError(error)).toBe("pool-timeout");
    expect(mayHaveCommitted(error)).toBe(false);
  });

  it("classifies the exact live pool-timeout shape (plain Error, no code)", () => {
    // Verified against the real stack: with the pool exhausted, Prisma
    // surfaces pg's own error unwrapped.
    const error = new Error("timeout exceeded when trying to connect");
    expect(classifyDatabaseError(error)).toBe("pool-timeout");
  });

  it("classifies a backend terminated mid-query (57P01 in the chain)", () => {
    // Verified live: pg_terminate_backend during a query surfaces as
    // P2010 with the SQLSTATE in the message and in the adapter cause.
    const error = new Prisma.PrismaClientKnownRequestError(
      "Raw query failed. Code: `57P01`. Message: `terminating connection due to administrator command`",
      { code: "P2010", clientVersion: "7.10.0" },
    );
    expect(classifyDatabaseError(error)).toBe("connection");
    expect(mayHaveCommitted(error)).toBe(true);
  });

  it("classifies Prisma's P2024 pool timeout", () => {
    expect(classifyDatabaseError(knownError("P2024"))).toBe("pool-timeout");
  });

  it("classifies connection-loss SQLSTATEs and errnos in the chain", () => {
    const terminated = new Error("query failed") as Error & { code?: string };
    terminated.code = "57P01";
    expect(classifyDatabaseError(terminated)).toBe("connection");
    const refused = new Error("connect failed") as Error & { code?: string };
    refused.code = "ECONNREFUSED";
    expect(classifyDatabaseError(refused)).toBe("connection");
  });

  it("does not classify business or unknown errors as database failures", () => {
    expect(classifyDatabaseError(new Error("boom"))).toBeNull();
    expect(
      classifyDatabaseError(new PaymentValidationError({ amount: "bad" })),
    ).toBeNull();
    // A unique-constraint violation is a business conflict, not an outage.
    expect(classifyDatabaseError(knownError("P2002"))).toBeNull();
    expect(classifyDatabaseError(knownError("P2025"))).toBeNull();
    expect(classifyDatabaseError(null)).toBeNull();
    expect(classifyDatabaseError("string failure")).toBeNull();
    expect(mayHaveCommitted(new Error("boom"))).toBe(false);
  });
});
