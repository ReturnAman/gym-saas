import { describe, expect, it } from "vitest";

import {
  MEMBERSHIP_EXPIRING_WITHIN_DAYS,
  PLAN_DURATIONS_MONTHS,
  MemberValidationError,
  addCalendarMonths,
  calculateExpiryDate,
  deriveMembershipPayments,
  deriveMembershipStatus,
  derivePaymentStatus,
  formatInr,
  parseDateInput,
  validateFee,
  validateMemberInput,
  validateName,
  validatePhoneNumber,
} from "@/lib/members";

function utcDate(iso: string): Date {
  const parsed = parseDateInput(iso);
  if (!parsed) throw new Error(`bad fixture date: ${iso}`);
  return parsed;
}

function catchValidation(fn: () => unknown): MemberValidationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof MemberValidationError) return error;
    throw error;
  }
  throw new Error("expected MemberValidationError");
}

describe("validatePhoneNumber", () => {
  it("accepts exactly 10 digits", () => {
    expect(validatePhoneNumber("9876543210")).toBe("9876543210");
  });

  it("trims surrounding whitespace but never transforms the digits", () => {
    expect(validatePhoneNumber("  9876543210  ")).toBe("9876543210");
  });

  it.each([
    ["987654321", "9 digits"],
    ["98765432101", "11 digits"],
    ["+919876543210", "country code"],
    ["98765abc10", "letters"],
    ["98765 4321", "inner space"],
    ["987654321o", "lookalike letter"],
    ["", "empty"],
  ])("rejects %s (%s) without silent transformation", (input) => {
    expect(() => validatePhoneNumber(input)).toThrow(MemberValidationError);
  });
});

describe("validateName", () => {
  it("accepts a normal name and trims it", () => {
    expect(validateName("  Rahul Sharma ")).toBe("Rahul Sharma");
  });

  it("rejects blank names", () => {
    const error = catchValidation(() => validateName("   "));
    expect(error.errors.name).toMatch(/required/i);
  });

  it("rejects overlong names", () => {
    const error = catchValidation(() => validateName("x".repeat(121)));
    expect(error.errors.name).toMatch(/at most/);
  });
});

describe("validateFee", () => {
  it("parses whole rupees to exact paise", () => {
    expect(validateFee("6000")).toBe(600_000);
  });

  it("parses paise without floating point", () => {
    expect(validateFee("6000.50")).toBe(600_050);
    expect(validateFee("6000.5")).toBe(600_050);
  });

  it("accepts zero", () => {
    expect(validateFee("0")).toBe(0);
  });

  it.each([[""], ["abc"], ["-5"], ["6000.555"], ["6,000"], ["₹6000"]])(
    "rejects %s",
    (input) => {
      expect(() => validateFee(input)).toThrow(MemberValidationError);
    },
  );
});

describe("validateMemberInput", () => {
  const valid = {
    name: "Rahul Sharma",
    phoneNumber: "9876543210",
    fee: "6000",
    plan: "THREE_MONTHS",
    startDate: "2026-08-01",
  };

  it("validates a complete input and derives the expiry date", () => {
    const result = validateMemberInput(valid);
    expect(result.name).toBe("Rahul Sharma");
    expect(result.phoneNumber).toBe("9876543210");
    expect(result.feePaise).toBe(600_000);
    expect(result.plan).toBe("THREE_MONTHS");
    expect(result.startDate).toEqual(utcDate("2026-08-01"));
    expect(result.expiryDate).toEqual(utcDate("2026-11-01"));
  });

  it("collects every field error instead of failing fast", () => {
    try {
      validateMemberInput({
        name: "",
        phoneNumber: "123",
        fee: "abc",
        plan: "YEARLY",
        startDate: "",
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MemberValidationError);
      const errors = (error as MemberValidationError).errors;
      expect(Object.keys(errors).sort()).toEqual(
        ["fee", "name", "phoneNumber", "plan", "startDate"].sort(),
      );
    }
  });

  it("rejects a start date that must be chosen explicitly", () => {
    const error = catchValidation(() =>
      validateMemberInput({ ...valid, startDate: "" }),
    );
    expect(error.errors.startDate).toMatch(/start date/i);
  });

  it("rejects impossible calendar dates", () => {
    expect(() =>
      validateMemberInput({ ...valid, startDate: "2026-02-30" }),
    ).toThrow(MemberValidationError);
  });
});

describe("plan durations", () => {
  it("uses the four V1 plans with calendar-month durations", () => {
    expect(PLAN_DURATIONS_MONTHS).toEqual({
      MONTHLY: 1,
      THREE_MONTHS: 3,
      SIX_MONTHS: 6,
      TWELVE_MONTHS: 12,
    });
  });
});

describe("calculateExpiryDate", () => {
  it("adds calendar months, not day approximations", () => {
    // Finalized UX example: 01/08/2026 + 6 months → 01/02/2027.
    expect(calculateExpiryDate(utcDate("2026-08-01"), "SIX_MONTHS")).toEqual(
      utcDate("2027-02-01"),
    );
    expect(calculateExpiryDate(utcDate("2026-01-15"), "MONTHLY")).toEqual(
      utcDate("2026-02-15"),
    );
    expect(calculateExpiryDate(utcDate("2026-03-10"), "TWELVE_MONTHS")).toEqual(
      utcDate("2027-03-10"),
    );
  });

  it("clamps to the last day of the target month", () => {
    expect(addCalendarMonths(utcDate("2026-01-31"), 1)).toEqual(
      utcDate("2026-02-28"),
    );
    // Leap year.
    expect(addCalendarMonths(utcDate("2024-01-31"), 1)).toEqual(
      utcDate("2024-02-29"),
    );
    expect(addCalendarMonths(utcDate("2026-08-31"), 6)).toEqual(
      utcDate("2027-02-28"),
    );
  });
});

describe("deriveMembershipStatus", () => {
  const today = utcDate("2026-10-01");

  it("is EXPIRED the day after the expiry date", () => {
    expect(deriveMembershipStatus(utcDate("2026-09-30"), today)).toBe("EXPIRED");
  });

  it("is not EXPIRED on the expiry date itself", () => {
    expect(deriveMembershipStatus(utcDate("2026-10-01"), today)).toBe(
      "EXPIRING",
    );
    expect(
      deriveMembershipStatus(utcDate("2026-10-01"), utcDate("2026-10-02")),
    ).toBe("EXPIRED");
  });

  it(`is EXPIRING within ${MEMBERSHIP_EXPIRING_WITHIN_DAYS} days of expiry`, () => {
    expect(deriveMembershipStatus(utcDate("2026-10-08"), today)).toBe(
      "EXPIRING",
    );
    expect(deriveMembershipStatus(utcDate("2026-10-09"), today)).toBe("ACTIVE");
  });

  it("is ACTIVE well before expiry", () => {
    expect(deriveMembershipStatus(utcDate("2027-02-01"), today)).toBe("ACTIVE");
  });
});

describe("derivePaymentStatus", () => {
  it("is UNPAID for a new membership (fee agreed, nothing paid)", () => {
    expect(derivePaymentStatus(600_000, 0)).toBe("UNPAID");
  });

  it("is PAID when nothing is outstanding", () => {
    expect(derivePaymentStatus(0, 0)).toBe("PAID");
    expect(derivePaymentStatus(600_000, 600_000)).toBe("PAID");
  });

  it("is PARTIALLY_PAID when some amount is paid", () => {
    expect(derivePaymentStatus(600_000, 200_000)).toBe("PARTIALLY_PAID");
  });
});

describe("deriveMembershipPayments", () => {
  it("reports paid ₹0 and outstanding = fee while no payment domain exists", () => {
    // No payment records exist in this slice, so nothing has been paid —
    // these are derived values, not a persisted payment balance.
    expect(deriveMembershipPayments(600_000)).toEqual({
      paidPaise: 0,
      outstandingPaise: 600_000,
    });
  });

  it("reports a zero fee as fully paid", () => {
    expect(deriveMembershipPayments(0)).toEqual({
      paidPaise: 0,
      outstandingPaise: 0,
    });
  });
});

describe("formatInr", () => {
  it("formats paise as INR without floating point", () => {
    expect(formatInr(600_000)).toBe("₹6,000");
    expect(formatInr(600_050)).toBe("₹6,000.50");
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(100)).toBe("₹1");
  });
});
