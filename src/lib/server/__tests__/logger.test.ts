import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import {
  isValidCorrelationId,
  resolveCorrelationId,
} from "@/lib/server/correlation";
import {
  logDatabaseFailure,
  logServerEvent,
  logUnexpectedError,
} from "@/lib/server/logger";

/**
 * Structured logging + correlation IDs (H3).
 *
 * The guarantees under test: a log line is single-line JSON built only
 * from whitelisted fields (an error's message — which may contain
 * connection strings, OTPs, or tokens — can never appear); the logger
 * never throws, even when the console itself fails; and an incoming
 * correlation ID is propagated only when it passes strict validation.
 */

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  errorSpy.mockClear();
  errorSpy.mockImplementation(() => {});
  warnSpy.mockClear();
  warnSpy.mockImplementation(() => {});
});

function lastErrorRecord(): Record<string, string> {
  expect(errorSpy).toHaveBeenCalledTimes(1);
  const line = errorSpy.mock.calls[0]?.[0] as string;
  expect(line).not.toContain("\n");
  return JSON.parse(line) as Record<string, string>;
}

describe("logServerEvent", () => {
  it("emits single-line JSON with the structured fields", () => {
    logServerEvent({
      level: "error",
      event: "database_unavailable",
      boundary: "POST /api/member-payments/claims",
      requestId: "req-12345678",
      errorKind: "connection",
      errorName: "PrismaClientKnownRequestError",
      errorCode: "P1001",
    });
    const record = lastErrorRecord();
    expect(record.event).toBe("database_unavailable");
    expect(record.level).toBe("error");
    expect(record.boundary).toBe("POST /api/member-payments/claims");
    expect(record.requestId).toBe("req-12345678");
    expect(record.errorKind).toBe("connection");
    expect(record.errorCode).toBe("P1001");
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("routes warn level to console.warn", () => {
    logServerEvent({
      level: "warn",
      event: "sms_provider_unavailable",
      boundary: "POST /api/member-auth/otp/request",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("never throws when the console itself fails", () => {
    errorSpy.mockImplementation(() => {
      throw new Error("console broken");
    });
    expect(() =>
      logServerEvent({ level: "error", event: "x", boundary: "y" }),
    ).not.toThrow();
  });
});

describe("failure helpers — redaction and classification", () => {
  const CANARY_URL = "postgresql://dbuser:super-secret-pw@db.internal:5432/gym";
  const CANARY_OTP = "482916";
  const CANARY_TOKEN = "gym_member_session=deadbeef-token-value";

  it("logDatabaseFailure logs classified errors without the error message", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      `Can't reach database server at ${CANARY_URL} otp ${CANARY_OTP} ${CANARY_TOKEN}`,
      { code: "P1001", clientVersion: "7.10.0" },
    );
    logDatabaseFailure({ boundary: "action:recordPayment", error });
    const line = errorSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("super-secret-pw");
    expect(line).not.toContain(CANARY_OTP);
    expect(line).not.toContain("deadbeef-token-value");
    expect(line).not.toContain("db.internal");
    const record = JSON.parse(line) as Record<string, string>;
    expect(record.event).toBe("database_unavailable");
    expect(record.errorKind).toBe("connection");
    expect(record.errorName).toBe("PrismaClientKnownRequestError");
    expect(record.errorCode).toBe("P1001");
  });

  it("logDatabaseFailure is a no-op for non-database errors", () => {
    logDatabaseFailure({
      boundary: "action:recordPayment",
      error: new Error("plain failure"),
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logUnexpectedError emits name and allowlisted code only", () => {
    const error = new Error(`boom ${CANARY_URL}`) as Error & { code?: string };
    error.code = "P2002";
    logUnexpectedError({ boundary: "POST /api/x", error });
    const line = errorSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("super-secret-pw");
    const record = JSON.parse(line) as Record<string, string>;
    expect(record.event).toBe("unexpected_error");
    expect(record.errorName).toBe("Error");
    expect(record.errorCode).toBe("P2002");
  });

  it("a code whose shape could carry data is dropped", () => {
    const error = new Error("x") as Error & { code?: string };
    error.code = "member-9000000011-secret";
    logUnexpectedError({ boundary: "POST /api/x", error });
    const record = lastErrorRecord();
    expect(record.errorCode).toBeUndefined();
  });
});

describe("hostile error objects — helpers never throw (H3 robustness fix)", () => {
  const CANARY = "getter-canary-value";

  function hostile(prop: "name" | "code" | "cause" | "meta") {
    const error = new Error("hostile");
    Object.defineProperty(error, prop, {
      get() {
        throw new Error(CANARY);
      },
    });
    return error;
  }

  function emittedLines(): string[] {
    return errorSpy.mock.calls.map((call) => String(call[0]));
  }

  it("throwing name getter: logUnexpectedError degrades, never throws, never leaks", () => {
    expect(() =>
      logUnexpectedError({ boundary: "probe", error: hostile("name") }),
    ).not.toThrow();
    for (const line of emittedLines()) {
      expect(line).not.toContain(CANARY);
      const record = JSON.parse(line) as Record<string, string>;
      expect(record.event).toBe("unexpected_error");
      expect(record.boundary).toBe("probe");
    }
  });

  it("throwing code getter: logUnexpectedError degrades, never throws", () => {
    expect(() =>
      logUnexpectedError({ boundary: "probe", error: hostile("code") }),
    ).not.toThrow();
    for (const line of emittedLines()) {
      expect(line).not.toContain(CANARY);
    }
  });

  it("throwing cause getter: logDatabaseFailure degrades to a minimal record, never throws", () => {
    expect(() =>
      logDatabaseFailure({ boundary: "probe", error: hostile("cause") }),
    ).not.toThrow();
    const lines = emittedLines();
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string) as Record<string, string>;
    expect(record.event).toBe("database_unavailable");
    expect(record.boundary).toBe("probe");
    expect(record.errorKind).toBeUndefined();
    expect(lines[0]).not.toContain(CANARY);
  });

  it("throwing meta getter: logDatabaseFailure never throws", () => {
    expect(() =>
      logDatabaseFailure({ boundary: "probe", error: hostile("meta") }),
    ).not.toThrow();
    for (const line of emittedLines()) {
      expect(line).not.toContain(CANARY);
    }
  });

  it("ordinary errors keep their full classification after the fix", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Can't reach database server",
      { code: "P1001", clientVersion: "7.10.0" },
    );
    logDatabaseFailure({ boundary: "probe", error });
    const record = lastErrorRecord();
    expect(record.errorKind).toBe("connection");
    expect(record.errorName).toBe("PrismaClientKnownRequestError");
    expect(record.errorCode).toBe("P1001");
  });
});

describe("correlation IDs", () => {  function requestWith(id: string | null) {
    return new Request("https://gym.example.com/api/health", {
      headers: id === null ? {} : { "x-request-id": id },
    });
  }

  it("accepts a well-formed incoming ID", () => {
    expect(isValidCorrelationId("123e4567-e89b-42d3-a456-426614174000")).toBe(
      true,
    );
    expect(
      resolveCorrelationId(
        requestWith("123e4567-e89b-42d3-a456-426614174000"),
      ),
    ).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("rejects malformed incoming IDs and generates a fresh UUID", () => {
    for (const bad of [
      "short",
      "has spaces in it........",
      "a".repeat(65),
      "../../etc/passwd........",
      "",
    ]) {
      expect(isValidCorrelationId(bad)).toBe(false);
      const generated = resolveCorrelationId(requestWith(bad));
      expect(generated).not.toBe(bad);
      expect(generated).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it("generates an ID when the header is absent, and IDs differ", () => {
    const a = resolveCorrelationId(requestWith(null));
    const b = resolveCorrelationId(requestWith(null));
    expect(isValidCorrelationId(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});
