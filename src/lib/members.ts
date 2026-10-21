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
//   payments). Paid/outstanding are derived via deriveMembershipPayments
//   from the confirmed payment records — never a persisted balance;
//   Membership deliberately has no paid_amount column.

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
export type PaymentStatus = "PAID" | "PARTIALLY_PAID" | "UNPAID" | "OVERPAID";

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  ACTIVE: "Active",
  EXPIRING: "Expiring",
  EXPIRED: "Expired",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: "Paid",
  PARTIALLY_PAID: "Partially paid",
  UNPAID: "Unpaid",
  OVERPAID: "Overpaid",
};

/** Payment methods recorded for a confirmed payment (Payments V1). */
export const PAYMENT_METHODS = ["UPI", "CASH", "CARD", "OTHER"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  UPI: "UPI",
  CASH: "Cash",
  CARD: "Card",
  OTHER: "Other",
};

export const MAX_PAYMENT_REFERENCE_LENGTH = 120;

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

/**
 * Derive payment status from exact paise amounts.
 * paid = 0 → UNPAID; 0 < paid < fee → PARTIALLY_PAID; paid = fee → PAID;
 * paid > fee → OVERPAID. The paid total itself is never altered.
 */
export function derivePaymentStatus(
  feePaise: number,
  paidPaise: number,
): PaymentStatus {
  if (paidPaise > feePaise) return "OVERPAID";
  const outstandingPaise = feePaise - paidPaise;
  if (outstandingPaise <= 0) return "PAID";
  if (paidPaise > 0) return "PARTIALLY_PAID";
  return "UNPAID";
}

/**
 * Derive a membership's paid/outstanding amounts.
 *
 * `paidPaise` is SUM(confirmed payments) − SUM(payment reversals) against
 * the membership, supplied net by the server layer from the ledger
 * records, and is always reported exactly
 * — including when it exceeds the fee. Outstanding is fee − paid, floored
 * at zero: an overpayment makes outstanding ₹0 with status OVERPAID, never
 * a negative balance. These are derived values, not a persisted payment
 * balance — Membership deliberately has no paid_amount column
 * (04-DATABASE-DESIGN §16).
 */
export function deriveMembershipPayments(
  feePaise: number,
  paidPaise: number,
): {
  paidPaise: number;
  outstandingPaise: number;
} {
  return { paidPaise, outstandingPaise: Math.max(0, feePaise - paidPaise) };
}

export type PaymentField = "amount" | "paymentMethod" | "reference";

/** Thrown when payment input fails validation. Carries per-field messages. */
export class PaymentValidationError extends Error {
  errors: Partial<Record<PaymentField | "form", string>>;

  constructor(errors: Partial<Record<PaymentField | "form", string>>) {
    super("Payment validation failed.");
    this.name = "PaymentValidationError";
    this.errors = errors;
  }
}

export interface PaymentInput {
  /** Decimal string, e.g. "6000" or "6000.50". Must be greater than zero. */
  amount: string;
  paymentMethod: string;
  /** Optional free-text reference; empty means none. */
  reference: string;
}

export interface ValidatedPaymentInput {
  /** Integer paise — exact, never floating point. Always > 0. */
  amountPaise: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
}

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Full record-payment input validation. Server-side authoritative. */
export function validatePaymentInput(input: PaymentInput): ValidatedPaymentInput {
  const errors: Partial<Record<PaymentField, string>> = {};

  let amountPaise = 0;
  const amount = input.amount.trim();
  if (!FEE_REGEX.test(amount)) {
    errors.amount = "Amount must be a valid amount, for example 6000 or 6000.50.";
  } else {
    const [rupeesPart, paisePart = ""] = amount.split(".");
    amountPaise =
      Number(rupeesPart) * 100 + Number(paisePart.padEnd(2, "0") || "0");
    if (!Number.isSafeInteger(amountPaise) || amountPaise > MAX_FEE_PAISE) {
      errors.amount = "Amount is too large.";
    } else if (amountPaise <= 0) {
      errors.amount = "Amount must be greater than zero.";
    }
  }

  let paymentMethod: PaymentMethod | null = null;
  if (isPaymentMethod(input.paymentMethod.trim())) {
    paymentMethod = input.paymentMethod.trim() as PaymentMethod;
  } else {
    errors.paymentMethod = "Choose a payment method: UPI, Cash, Card, or Other.";
  }

  const referenceText = input.reference.trim();
  if (referenceText.length > MAX_PAYMENT_REFERENCE_LENGTH) {
    errors.reference = `Reference must be at most ${MAX_PAYMENT_REFERENCE_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0 || !paymentMethod) {
    throw new PaymentValidationError(errors);
  }

  return {
    amountPaise,
    paymentMethod,
    reference: referenceText === "" ? null : referenceText,
  };
}

/** Reason categories for a payment reversal (mirrors the database enum). */
export const PAYMENT_REVERSAL_REASONS = [
  "DUPLICATE_ENTRY",
  "WRONG_MEMBER",
  "WRONG_AMOUNT",
  "PAYMENT_FAILED",
  "REFUNDED_TO_MEMBER",
  "OTHER",
] as const;

export type PaymentReversalReason = (typeof PAYMENT_REVERSAL_REASONS)[number];

/**
 * Member-facing labels for reversal reasons — members see these exact
 * wordings; staff interfaces may show the raw category instead. A
 * reversal records a ledger correction the gym has made: the
 * REFUNDED_TO_MEMBER label reports the recorded reason and is not, by
 * itself, proof that money moved through a bank or payment gateway.
 */
export const PAYMENT_REVERSAL_REASON_LABELS: Record<
  PaymentReversalReason,
  string
> = {
  DUPLICATE_ENTRY: "Duplicate entry corrected",
  WRONG_MEMBER: "Recorded for the wrong member",
  WRONG_AMOUNT: "Wrong amount corrected",
  PAYMENT_FAILED: "Payment did not go through",
  REFUNDED_TO_MEMBER: "Refunded to you",
  OTHER: "Adjustment by the gym",
};

export const MAX_REVERSAL_EXPLANATION_LENGTH = 280;

export type PaymentReversalField = "amount" | "reason" | "explanation";

/** Thrown when reversal input fails validation. Carries per-field messages. */
export class PaymentReversalValidationError extends Error {
  errors: Partial<Record<PaymentReversalField | "form", string>>;

  constructor(errors: Partial<Record<PaymentReversalField | "form", string>>) {
    super("Payment reversal validation failed.");
    this.name = "PaymentReversalValidationError";
    this.errors = errors;
  }
}

export interface PaymentReversalInput {
  /** Decimal string, e.g. "6000" or "6000.50". Must be greater than zero. */
  amount: string;
  /** One of PAYMENT_REVERSAL_REASONS. */
  reason: string;
  /** Optional free-text explanation; empty means none. */
  explanation: string;
}

export interface ValidatedPaymentReversalInput {
  /** Integer paise — exact, never floating point. Always > 0. */
  amountPaise: number;
  reason: PaymentReversalReason;
  explanation: string | null;
}

export function isPaymentReversalReason(
  value: string,
): value is PaymentReversalReason {
  return (PAYMENT_REVERSAL_REASONS as readonly string[]).includes(value);
}

/** Full payment-reversal input validation. Server-side authoritative. */
export function validatePaymentReversalInput(
  input: PaymentReversalInput,
): ValidatedPaymentReversalInput {
  const errors: Partial<Record<PaymentReversalField, string>> = {};

  let amountPaise = 0;
  const amount = input.amount.trim();
  if (!FEE_REGEX.test(amount)) {
    errors.amount =
      "Amount must be a valid amount, for example 6000 or 6000.50.";
  } else {
    const [rupeesPart, paisePart = ""] = amount.split(".");
    amountPaise =
      Number(rupeesPart) * 100 + Number(paisePart.padEnd(2, "0") || "0");
    if (!Number.isSafeInteger(amountPaise) || amountPaise > MAX_FEE_PAISE) {
      errors.amount = "Amount is too large.";
    } else if (amountPaise <= 0) {
      errors.amount = "Amount must be greater than zero.";
    }
  }

  let reason: PaymentReversalReason | null = null;
  if (isPaymentReversalReason(input.reason.trim())) {
    reason = input.reason.trim() as PaymentReversalReason;
  } else {
    errors.reason = "Choose a reason for the reversal.";
  }

  const explanationText = input.explanation.trim();
  if (explanationText.length > MAX_REVERSAL_EXPLANATION_LENGTH) {
    errors.explanation = `Explanation must be at most ${MAX_REVERSAL_EXPLANATION_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0 || !reason) {
    throw new PaymentReversalValidationError(errors);
  }

  return {
    amountPaise,
    reason,
    explanation: explanationText === "" ? null : explanationText,
  };
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
