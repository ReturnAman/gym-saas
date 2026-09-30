// Pure Member/Membership domain logic.
//
// This module is intentionally free of `server-only` so it can be shared
// between server code (authoritative validation) and client components
// (live membership summary). It never touches the database.
//
// Date conventions (chosen — no repo-wide convention exists; flagged in the
// implementation report):
// - Dates are calendar dates (no time component). All comparisons use UTC
//   calendar days.
// - expiryDate = startDate + plan duration in calendar months, with the day
//   clamped to the last day of the target month
//   (e.g. 31 Jan + 1 month → 28 Feb in a non-leap year).
// - A membership is ACTIVE through its expiry date inclusive; it becomes
//   EXPIRED when today's UTC date is after the expiry date.
// - EXPIRING means the expiry date is within MEMBERSHIP_EXPIRING_WITHIN_DAYS
//   days (inclusive). The exact threshold is a product decision —
//   17-PRODUCT-UX-SPEC §22 does not define it; 7 days is the default used
//   here.
//
// Money conventions:
// - Amounts are validated as strings and normalized to integer paise —
//   never floating point. The server layer converts paise to Prisma Decimal.
// - Payment is a separate domain (04-DATABASE-DESIGN §16, §17): the
//   finalized calculation is Outstanding = charge amount − SUM(confirmed
//   payments). There is no payment domain yet, so paid is always ₹0 and
//   outstanding is the full fee — both derived via deriveMembershipPayments,
//   never a persisted payment balance.

/** Fixed V1 membership plans (product rule — not owner-configurable yet). */
export const MEMBERSHIP_PLANS = [
  "MONTHLY",
  "THREE_MONTHS",
  "SIX_MONTHS",
  "TWELVE_MONTHS",
] as const;

export type MembershipPlan = (typeof MEMBERSHIP_PLANS)[number];

export const PLAN_LABELS: Record<MembershipPlan, string> = {
  MONTHLY: "Monthly",
  THREE_MONTHS: "3 Months",
  SIX_MONTHS: "6 Months",
  TWELVE_MONTHS: "12 Months",
};

export const PLAN_DURATIONS_MONTHS: Record<MembershipPlan, number> = {
  MONTHLY: 1,
  THREE_MONTHS: 3,
  SIX_MONTHS: 6,
  TWELVE_MONTHS: 12,
};

export const MAX_MEMBER_NAME_LENGTH = 120;

/** Exactly 10 ASCII digits — no country code, no separators, no letters. */
const PHONE_REGEX = /^[0-9]{10}$/;

/** Non-negative INR amount with at most 2 decimal places. */
const FEE_REGEX = /^\d+(\.\d{1,2})?$/;

/** Decimal(12,2) maximum, expressed in paise. */
const MAX_FEE_PAISE = 999_999_999_999;

/**
 * Days before expiry at which a membership counts as EXPIRING.
 * Product decision needed — see the module header.
 */
export const MEMBERSHIP_EXPIRING_WITHIN_DAYS = 7;

export type MembershipStatus = "ACTIVE" | "EXPIRING" | "EXPIRED";
export type PaymentStatus = "PAID" | "PARTIALLY_PAID" | "UNPAID";

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  ACTIVE: "Active",
  EXPIRING: "Expiring",
  EXPIRED: "Expired",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: "Paid",
  PARTIALLY_PAID: "Partially paid",
  UNPAID: "Unpaid",
};

export type MemberField = "name" | "phoneNumber" | "fee" | "plan" | "startDate";

/** Thrown when member input fails validation. Carries per-field messages. */
export class MemberValidationError extends Error {
  errors: Partial<Record<MemberField | "form", string>>;

  constructor(errors: Partial<Record<MemberField | "form", string>>) {
    super("Member validation failed.");
    this.name = "MemberValidationError";
    this.errors = errors;
  }
}

export interface MemberInput {
  name: string;
  phoneNumber: string;
  /** Decimal string, e.g. "6000" or "6000.50". */
  fee: string;
  plan: string;
  /** Calendar date "YYYY-MM-DD". */
  startDate: string;
}

export interface ValidatedMemberInput {
  name: string;
  phoneNumber: string;
  /** Integer paise — exact, never floating point. */
  feePaise: number;
  plan: MembershipPlan;
  /** UTC midnight. */
  startDate: Date;
  /** UTC midnight, derived from startDate + plan duration. */
  expiryDate: Date;
}

/** "YYYY-MM-DD" → Date at UTC midnight, or null when not a real calendar date. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject overflow dates such as 2026-02-30.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Add calendar months to a UTC-midnight date, clamping to the target month's last day. */
export function addCalendarMonths(date: Date, months: number): Date {
  const targetMonth = date.getUTCMonth() + months;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const targetMonthIndex = ((targetMonth % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonthIndex,
      Math.min(date.getUTCDate(), lastDayOfTargetMonth),
    ),
  );
}

export function calculateExpiryDate(
  startDate: Date,
  plan: MembershipPlan,
): Date {
  return addCalendarMonths(startDate, PLAN_DURATIONS_MONTHS[plan]);
}

/** Strip the time component — UTC calendar day at midnight. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function isMembershipPlan(value: string): value is MembershipPlan {
  return (MEMBERSHIP_PLANS as readonly string[]).includes(value);
}

/** Validate a member name per the shared rules; returns the trimmed name. */
export function validateName(raw: string): string {
  const name = raw.trim();
  if (!name) {
    throw new MemberValidationError({ name: "Member name is required." });
  }
  if (name.length > MAX_MEMBER_NAME_LENGTH) {
    throw new MemberValidationError({
      name: `Member name must be at most ${MAX_MEMBER_NAME_LENGTH} characters.`,
    });
  }
  return name;
}

/**
 * Validate a phone number: exactly 10 ASCII digits. Invalid input is
 * rejected — never silently transformed into something valid.
 */
export function validatePhoneNumber(raw: string): string {
  const phoneNumber = raw.trim();
  if (!PHONE_REGEX.test(phoneNumber)) {
    throw new MemberValidationError({
      phoneNumber: "Phone number must be exactly 10 digits.",
    });
  }
  return phoneNumber;
}

/** Validate a fee string; returns integer paise. */
export function validateFee(raw: string): number {
  const fee = raw.trim();
  if (!FEE_REGEX.test(fee)) {
    throw new MemberValidationError({
      fee: "Fee must be a valid amount, for example 6000 or 6000.50.",
    });
  }
  const [rupeesPart, paisePart = ""] = fee.split(".");
  const feePaise =
    Number(rupeesPart) * 100 + Number(paisePart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(feePaise) || feePaise > MAX_FEE_PAISE) {
    throw new MemberValidationError({
      fee: "Fee is too large.",
    });
  }
  return feePaise;
}

/** Full add-member input validation. Server-side authoritative. */
export function validateMemberInput(input: MemberInput): ValidatedMemberInput {
  const errors: Partial<Record<MemberField, string>> = {};

  let name = "";
  let phoneNumber = "";
  let feePaise = 0;
  let plan: MembershipPlan | null = null;
  let startDate: Date | null = null;

  try {
    name = validateName(input.name);
  } catch (error) {
    if (error instanceof MemberValidationError) Object.assign(errors, error.errors);
  }
  try {
    phoneNumber = validatePhoneNumber(input.phoneNumber);
  } catch (error) {
    if (error instanceof MemberValidationError) Object.assign(errors, error.errors);
  }
  try {
    feePaise = validateFee(input.fee);
  } catch (error) {
    if (error instanceof MemberValidationError) Object.assign(errors, error.errors);
  }
  if (isMembershipPlan(input.plan.trim())) {
    plan = input.plan.trim() as MembershipPlan;
  } else {
    errors.plan = "Choose a membership plan: Monthly, 3 Months, 6 Months, or 12 Months.";
  }
  const parsed = parseDateInput(input.startDate);
  if (!parsed) {
    errors.startDate = "Start date is required. Choose the actual membership start date.";
  } else {
    startDate = parsed;
  }

  if (Object.keys(errors).length > 0 || !plan || !startDate) {
    throw new MemberValidationError(errors);
  }

  return {
    name,
    phoneNumber,
    feePaise,
    plan,
    startDate,
    expiryDate: calculateExpiryDate(startDate, plan),
  };
}

/**
 * Derive membership status from the expiry date.
 * `today` defaults to now; pass an explicit date in tests.
 */
export function deriveMembershipStatus(
  expiryDate: Date,
  today: Date = new Date(),
): MembershipStatus {
  const todayDay = startOfUtcDay(today).getTime();
  const expiryDay = startOfUtcDay(expiryDate).getTime();
  const diffDays = Math.round((expiryDay - todayDay) / 86_400_000);
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= MEMBERSHIP_EXPIRING_WITHIN_DAYS) return "EXPIRING";
  return "ACTIVE";
}

/** Derive payment status from exact paise amounts. Outstanding = fee − paid. */
export function derivePaymentStatus(
  feePaise: number,
  paidPaise: number,
): PaymentStatus {
  const outstandingPaise = feePaise - paidPaise;
  if (outstandingPaise <= 0) return "PAID";
  if (paidPaise > 0) return "PARTIALLY_PAID";
  return "UNPAID";
}

/**
 * Derive a membership's paid/outstanding amounts for the current slice.
 *
 * The payment domain does not exist yet (no charge/payment records), so
 * paid is always ₹0 and outstanding is the full fee. These are
 * UI/domain-derived values, not a persisted payment balance — Membership
 * deliberately has no paid_amount column. When payment claims and
 * confirmed payments land, paid becomes SUM(confirmed payments) against
 * the membership's charge (04-DATABASE-DESIGN §16); call sites keep their
 * shape and only the source of the paid amount changes.
 */
export function deriveMembershipPayments(feePaise: number): {
  paidPaise: number;
  outstandingPaise: number;
} {
  const paidPaise = 0;
  return { paidPaise, outstandingPaise: feePaise - paidPaise };
}

/** Format integer paise as INR without floating-point arithmetic. */
export function formatInr(paise: number): string {
  const rounded = Math.trunc(paise);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  const grouped = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(rupees);
  const fraction = remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`;
  return `${sign}₹${grouped}${fraction}`;
}

/** Format a UTC-midnight date as DD/MM/YYYY. */
export function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}
