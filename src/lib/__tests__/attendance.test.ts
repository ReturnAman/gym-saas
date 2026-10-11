import { describe, expect, it } from "vitest";

import {
  attendanceSourceLabel,
  buildMemberCheckInUrl,
  formatKolkataDate,
  formatKolkataDateTime,
  formatKolkataTime,
  getKolkataDayBoundsUtc,
} from "@/lib/attendance";

/**
 * Asia/Kolkata day bounds. Kolkata is UTC+05:30 year-round, so IST
 * midnight is 18:30 UTC of the previous UTC day — but the helper must
 * derive that from the IANA zone via Intl, and these tests pin the
 * behavior around the IST midnight boundary (18:30 UTC).
 */
describe("getKolkataDayBoundsUtc", () => {
  it("returns the IST day for an instant just before IST midnight", () => {
    // 2026-10-10T18:29:59Z is 2026-10-10 23:59:59 IST — still Oct 10 in
    // Kolkata, so the day runs Oct 9 18:30Z → Oct 10 18:30Z.
    const { startUtc, endUtc } = getKolkataDayBoundsUtc(
      new Date("2026-10-10T18:29:59.000Z"),
    );
    expect(startUtc.toISOString()).toBe("2026-10-09T18:30:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-10-10T18:30:00.000Z");
  });

  it("rolls to the next IST day exactly at IST midnight", () => {
    // 2026-10-10T18:30:00Z is 2026-10-11 00:00:00 IST.
    const { startUtc, endUtc } = getKolkataDayBoundsUtc(
      new Date("2026-10-10T18:30:00.000Z"),
    );
    expect(startUtc.toISOString()).toBe("2026-10-10T18:30:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-10-11T18:30:00.000Z");
  });

  it("returns the IST day for a mid-day instant", () => {
    // 2026-10-10T04:00:00Z is 09:30 IST on Oct 10.
    const { startUtc, endUtc } = getKolkataDayBoundsUtc(
      new Date("2026-10-10T04:00:00.000Z"),
    );
    expect(startUtc.toISOString()).toBe("2026-10-09T18:30:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-10-10T18:30:00.000Z");
  });

  it("always spans exactly 24 hours (Kolkata has no DST)", () => {
    for (const iso of [
      "2026-01-15T00:00:00.000Z",
      "2026-06-15T12:34:56.000Z",
      "2026-10-10T18:30:00.000Z",
      "2026-12-31T23:59:59.000Z",
    ]) {
      const { startUtc, endUtc } = getKolkataDayBoundsUtc(new Date(iso));
      expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 3_600_000);
    }
  });

  it("contains the instant it was computed for", () => {
    const now = new Date("2026-10-10T07:15:00.000Z");
    const { startUtc, endUtc } = getKolkataDayBoundsUtc(now);
    expect(startUtc.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(now.getTime()).toBeLessThan(endUtc.getTime());
  });
});

describe("Kolkata formatters", () => {
  it("formats dates on the Kolkata calendar, not the UTC one", () => {
    // 18:30Z is already Oct 11 in Kolkata.
    expect(formatKolkataDate(new Date("2026-10-10T18:30:00.000Z"))).toBe(
      "11/10/2026",
    );
    expect(formatKolkataDate(new Date("2026-10-10T18:29:59.000Z"))).toBe(
      "10/10/2026",
    );
  });

  it("formats times in Kolkata wall-clock", () => {
    // 13:00 IST = 07:30 UTC.
    expect(formatKolkataTime(new Date("2026-10-10T07:30:00.000Z"))).toMatch(
      /1:00\s?[Pp][Mm]/,
    );
    // IST midnight = 18:30 UTC.
    expect(formatKolkataTime(new Date("2026-10-10T18:30:00.000Z"))).toMatch(
      /12:00\s?[Aa][Mm]/,
    );
  });
});

describe("member-facing Kolkata formatters (ISO string inputs)", () => {
  it("formats the IST date and time across the UTC→IST day boundary", () => {
    // 2026-10-09T19:00Z is already 2026-10-10 00:30 IST — the Kolkata
    // calendar date is Oct 10, not the UTC date Oct 9.
    expect(formatKolkataDate("2026-10-09T19:00:00.000Z")).toBe("10 Oct 2026");
    expect(formatKolkataTime("2026-10-09T19:00:00.000Z")).toBe("12:30 am");
    expect(formatKolkataDateTime("2026-10-09T19:00:00.000Z")).toBe(
      "10 Oct 2026, 12:30 am",
    );
  });

  it("formats a mid-day instant", () => {
    // 2026-10-10T05:00Z is 10:30 IST on Oct 10.
    expect(formatKolkataDate("2026-10-10T05:00:00.000Z")).toBe("10 Oct 2026");
    expect(formatKolkataTime("2026-10-10T05:00:00.000Z")).toBe("10:30 am");
    expect(formatKolkataDateTime("2026-10-10T05:00:00.000Z")).toBe(
      "10 Oct 2026, 10:30 am",
    );
  });

  it("labels attendance sources for member display", () => {
    expect(attendanceSourceLabel("MANUAL")).toBe("Manual");
    expect(attendanceSourceLabel("QR")).toBe("QR");
  });
});

describe("buildMemberCheckInUrl", () => {
  const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";

  it("builds the canonical check-in URL from a bare app URL", () => {
    expect(buildMemberCheckInUrl("https://gym.example.com", ORG_ID)).toBe(
      `https://gym.example.com/member/check-in?gym=${ORG_ID}`,
    );
  });

  it("strips a single trailing slash from the app URL", () => {
    expect(buildMemberCheckInUrl("https://gym.example.com/", ORG_ID)).toBe(
      `https://gym.example.com/member/check-in?gym=${ORG_ID}`,
    );
  });

  it("strips multiple trailing slashes from the app URL", () => {
    expect(buildMemberCheckInUrl("https://gym.example.com///", ORG_ID)).toBe(
      `https://gym.example.com/member/check-in?gym=${ORG_ID}`,
    );
  });

  it("produces a parseable URL with the gym as the only query parameter", () => {
    const url = new URL(buildMemberCheckInUrl("http://localhost:3000/", ORG_ID));
    expect(url.pathname).toBe("/member/check-in");
    expect(url.searchParams.get("gym")).toBe(ORG_ID);
    expect([...url.searchParams.keys()]).toEqual(["gym"]);
  });
});
