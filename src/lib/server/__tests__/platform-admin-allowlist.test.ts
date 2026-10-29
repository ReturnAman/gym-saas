import { describe, expect, it } from "vitest";

import {
  getPlatformAdminAllowlist,
  isPlatformAdmin,
  parseCalendarDate,
  parseMoneyAmount,
  parsePlatformAdminAllowlist,
} from "../platform-admin";

/**
 * Platform-admin authorization inputs: the allowlist must fail closed
 * (missing/empty/whitespace grants nobody access), and the financial and
 * date validators must reject malformed values before any mutation.
 */
describe("parsePlatformAdminAllowlist", () => {
  it("parses comma-separated IDs, trimming and deduplicating", () => {
    expect(
      parsePlatformAdminAllowlist("user_abc, user_def ,user_abc,"),
    ).toEqual(["user_abc", "user_def"]);
  });

  it("fails closed on missing, empty, or whitespace-only values", () => {
    expect(parsePlatformAdminAllowlist(undefined)).toEqual([]);
    expect(parsePlatformAdminAllowlist("")).toEqual([]);
    expect(parsePlatformAdminAllowlist("  ,  ")).toEqual([]);
    expect(parsePlatformAdminAllowlist(null)).toEqual([]);
    expect(parsePlatformAdminAllowlist(42)).toEqual([]);
  });

  it("reads the variable from the environment, fail closed when absent", () => {
    expect(
      getPlatformAdminAllowlist({
        NODE_ENV: "test",
        PLATFORM_ADMIN_CLERK_USER_IDS: "user_x",
      }),
    ).toEqual(["user_x"]);
    expect(getPlatformAdminAllowlist({ NODE_ENV: "test" })).toEqual([]);
  });
});

describe("isPlatformAdmin", () => {
  it("accepts only an allowlisted identity", () => {
    expect(isPlatformAdmin("user_abc", ["user_abc", "user_def"])).toBe(true);
    expect(isPlatformAdmin("user_zzz", ["user_abc"])).toBe(false);
    expect(isPlatformAdmin(null, ["user_abc"])).toBe(false);
    expect(isPlatformAdmin("user_abc", [])).toBe(false);
  });
});

describe("parseMoneyAmount", () => {
  it("accepts exact decimal amounts", () => {
    expect(parseMoneyAmount("5000").toString()).toBe("5000");
    expect(parseMoneyAmount("4999.50").toString()).toBe("4999.5");
  });

  it("rejects malformed, zero, negative, and over-precise amounts", () => {
    for (const bad of ["", "abc", "10.999", "-5", "0", "0.00", "1e3", "10,000"]) {
      expect(() => parseMoneyAmount(bad)).toThrow();
    }
  });
});

describe("parseCalendarDate", () => {
  it("parses YYYY-MM-DD as UTC midnight", () => {
    expect(parseCalendarDate("2026-11-01", "Period start").toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });

  it("rejects anything that is not a calendar date", () => {
    for (const bad of ["", "2026-13-01", "01/11/2026", "2026-11-01T00:00:00Z", 20261101]) {
      expect(() => parseCalendarDate(bad, "Period start")).toThrow();
    }
  });
});
