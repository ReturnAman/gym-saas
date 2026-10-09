import { describe, expect, it } from "vitest";

import {
  formatKolkataDate,
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
