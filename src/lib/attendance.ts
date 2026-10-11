// Pure attendance domain helpers.
//
// This module is intentionally free of `server-only` so it can be shared
// between server code and client components. It never touches the
// database.
//
// Time conventions:
// - Attendance instants are stored as UTC timestamptz. Gyms operate on
//   the Asia/Kolkata calendar day, so "today's attendance" means the
//   Kolkata calendar day containing the instant — NOT the UTC day. The
//   day bounds are derived from the IANA time zone via
//   Intl.DateTimeFormat; no numeric UTC offset is hardcoded anywhere.

/** The gym-local time zone used for attendance day boundaries. */
export const ATTENDANCE_TIME_ZONE = "Asia/Kolkata";

/** How a check-in was recorded (mirrors the AttendanceSource enum). */
export type AttendanceSourceValue = "MANUAL" | "QR";

export const ATTENDANCE_SOURCE_LABELS: Record<AttendanceSourceValue, string> = {
  MANUAL: "Manual",
  QR: "QR",
};

const kolkataPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ATTENDANCE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface KolkataParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock parts of an instant as seen in Asia/Kolkata. */
function kolkataParts(date: Date): KolkataParts {
  const parts = kolkataPartsFormatter.formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/**
 * Offset of Asia/Kolkata ahead of UTC, in milliseconds, at the given
 * instant — derived by round-tripping the instant's Kolkata wall-clock
 * parts through Date.UTC. Correct across historical/future rule changes
 * because Intl carries the IANA rules.
 */
function kolkataOffsetMs(date: Date): number {
  const parts = kolkataParts(date);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const instantSecondMs = Math.floor(date.getTime() / 1000) * 1000;
  return wallClockAsUtc - instantSecondMs;
}

/** The UTC instant of Kolkata midnight at the start of a Kolkata calendar date. */
function kolkataMidnightUtc(year: number, month: number, day: number): Date {
  const utcMidnight = Date.UTC(year, month - 1, day);
  // Solve midnight = utcMidnight − offset(midnight): evaluate the offset
  // at the naive guess, then once more at the refined instant so the
  // result is exact even if the offset changed in between.
  const firstGuess = utcMidnight - kolkataOffsetMs(new Date(utcMidnight));
  const refined = utcMidnight - kolkataOffsetMs(new Date(firstGuess));
  return new Date(refined);
}

export interface KolkataDayBounds {
  /** UTC instant of Kolkata midnight starting the day (inclusive). */
  startUtc: Date;
  /** UTC instant of the next Kolkata midnight (exclusive). */
  endUtc: Date;
}

/**
 * UTC bounds of the Asia/Kolkata calendar day containing `now`:
 * sessions with checkInAt in [startUtc, endUtc) happened "today" for the
 * gym. The bounds are always exactly 24h apart (Kolkata has no DST).
 */
export function getKolkataDayBoundsUtc(now: Date): KolkataDayBounds {
  const parts = kolkataParts(now);
  const startUtc = kolkataMidnightUtc(parts.year, parts.month, parts.day);
  const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const endUtc = kolkataMidnightUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );
  return { startUtc, endUtc };
}

const kolkataTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: ATTENDANCE_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const kolkataDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: ATTENDANCE_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const kolkataLongDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: ATTENDANCE_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Format an instant's wall-clock time in Asia/Kolkata, e.g. "6:30 pm".
 * Accepts a Date (server-side values) or an ISO string (API DTOs) — the
 * output is the same either way.
 */
export function formatKolkataTime(input: Date | string): string {
  return kolkataTimeFormatter.format(
    typeof input === "string" ? new Date(input) : input,
  );
}

/**
 * Format an instant's calendar date in Asia/Kolkata.
 *
 * Two call conventions exist in the codebase and keep their established
 * shapes: Date inputs (staff pages) format as DD/MM/YYYY, while ISO
 * string inputs (member-facing DTO timestamps) format in the long form,
 * e.g. "10 Oct 2026".
 */
export function formatKolkataDate(iso: string): string;
export function formatKolkataDate(date: Date): string;
export function formatKolkataDate(input: Date | string): string {
  return typeof input === "string"
    ? kolkataLongDateFormatter.format(new Date(input))
    : kolkataDateFormatter.format(input);
}

/** Format an ISO instant as "10 Oct 2026, 12:30 am" in Asia/Kolkata. */
export function formatKolkataDateTime(iso: string): string {
  return `${formatKolkataDate(iso)}, ${formatKolkataTime(iso)}`;
}

/** Display label for how a check-in was recorded, e.g. "Manual" / "QR". */
export function attendanceSourceLabel(source: AttendanceSourceValue): string {
  return ATTENDANCE_SOURCE_LABELS[source];
}

/**
 * Canonical member check-in URL for a gym — the target encoded in the
 * gym's printed QR poster (ADR 022). The organization ID is the only
 * variable part; it identifies the gym and grants no access by itself.
 * Trailing slashes on the configured app URL are stripped so the result
 * never contains a double slash before the path.
 */
export function buildMemberCheckInUrl(
  appUrl: string,
  organizationId: string,
): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/member/check-in?gym=${encodeURIComponent(organizationId)}`;
}
