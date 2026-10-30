/**
 * Member detail page — the C3-S3 read-only payment-claim history.
 *
 * Hermetic like the sibling section tests: the services are mocked,
 * the REAL claims authorization helper and formatters run, and the
 * page renders to string. Pins: every claim status renders with its
 * label and details (confirmed amount when applicable), pending
 * claims are explicitly not counted as paid, the empty state, no
 * internal IDs as visible text, the section hidden from roles that
 * cannot verify claims (with the service never called), a service
 * denial hiding the section without breaking the page, and the
 * pre-existing notFound behavior for unknown / foreign members —
 * where the claims read is never attempted.
 */
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PaymentClaimAuthorizationError,
  type PaymentClaimView,
} from "@/lib/server/payment-claims";
import type { MemberDetail } from "@/lib/server/members";

const {
  mockRequireContext,
  mockGetMemberDetail,
  mockListClaimsForMember,
} = vi.hoisted(() => ({
  mockRequireContext: vi.fn(),
  mockGetMemberDetail: vi.fn(),
  mockListClaimsForMember: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/server/subscriptions", () => ({
  requireEntitledOrganizationContext: mockRequireContext,
}));

vi.mock("@/lib/server/members", () => ({
  PAST_MEMBERSHIPS_LIMIT: 10,
  getMemberDetail: mockGetMemberDetail,
}));

vi.mock("./renewal-form", () => ({
  RenewalForm: (props: {
    memberId: string;
    defaultPlan: string;
    defaultFeePaise: number;
    newPeriodStartLabel: string;
    suggestedExpiryDate: string;
    pendingClaimsCount: number;
  }) => (
    <form
      data-member={props.memberId}
      data-plan={props.defaultPlan}
      data-fee={props.defaultFeePaise}
      data-start={props.newPeriodStartLabel}
      data-expiry={props.suggestedExpiryDate}
      data-pending={props.pendingClaimsCount}
    >
      Renew membership form
    </form>
  ),
}));

vi.mock("@/lib/server/attendance", () => ({
  getAttendancePermissions: () => ({
    canView: true,
    canManage: false,
    canCheckIn: false,
  }),
  getOpenSession: async () => null,
  listMemberAttendance: async () => [],
}));

vi.mock("@/lib/server/payment-claims", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/payment-claims")>();
  return { ...actual, listClaimsForMember: mockListClaimsForMember };
});

vi.mock("../../attendance/check-in-form", () => ({
  CheckInForm: () => null,
}));
vi.mock("../../attendance/check-out-form", () => ({
  CheckOutForm: () => null,
}));

import MemberDetailPage from "./page";

const DETAIL: MemberDetail = {
  id: "member-visible-1",
  name: "Asha Rao",
  phoneNumber: "9000000021",
  membership: {
    id: "membership-secret-1",
    plan: "MONTHLY",
    planLabel: "Monthly",
    startDate: "2026-01-01",
    expiryDate: "2026-02-01",
    feePaise: 100_000,
    paidPaise: 50_000,
    outstandingPaise: 50_000,
    membershipStatus: "ACTIVE",
    paymentStatus: "PARTIALLY_PAID",
    pendingClaimsCount: 0,
    payments: [],
    paymentsTruncated: false,
    reversals: [],
    reversalsTruncated: false,
  },
  pastMemberships: [],
  pastMembershipsTruncated: false,
  permissions: {
    canView: true,
    canCreate: false,
    canEdit: true,
    canRecordPayment: true,
    canReversePayment: true,
    canRenewMembership: true,
  },
};

function claimFixture(
  overrides: Partial<PaymentClaimView>,
): PaymentClaimView {
  return {
    id: "claim-secret",
    membershipId: "membership-secret-1",
    memberId: "member-visible-1",
    claimedAmountPaise: 60_000,
    paymentMethod: "UPI",
    reference: null,
    status: "PENDING",
    submittedAt: "2026-10-12T04:30:00.000Z",
    verifiedAt: null,
    confirmedAmountPaise: null,
    paymentId: null,
    ...overrides,
  };
}

const CLAIMS: PaymentClaimView[] = [
  claimFixture({
    id: "claim-secret-pending",
    reference: "UTR-CLAIM-1",
  }),
  claimFixture({
    id: "claim-secret-confirmed",
    status: "CONFIRMED",
    paymentMethod: "CASH",
    submittedAt: "2026-10-10T04:30:00.000Z",
    verifiedAt: "2026-10-10T05:00:00.000Z",
    confirmedAmountPaise: 55_000,
    paymentId: "payment-secret-1",
  }),
  claimFixture({
    id: "claim-secret-rejected",
    status: "REJECTED",
    claimedAmountPaise: 20_000,
    paymentMethod: "CARD",
    submittedAt: "2026-10-09T04:30:00.000Z",
    verifiedAt: "2026-10-09T05:00:00.000Z",
  }),
];

function setContext(role: string) {
  mockRequireContext.mockResolvedValue({
    user: { id: "staff-1" },
    membership: { role },
    organization: { id: "org-secret", name: "Sunrise Fitness" },
  });
}

function normalize(html: string): string {
  return html.replace(/\s+/g, " ");
}

async function renderDetail(role = "OWNER", id = "member-visible-1") {
  setContext(role);
  return renderToString(
    await MemberDetailPage({ params: Promise.resolve({ id }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMemberDetail.mockResolvedValue(DETAIL);
  mockListClaimsForMember.mockResolvedValue({ items: CLAIMS, truncated: false });
});

describe("member detail — claim history section (C3-S3)", () => {
  it("renders every status with its details for a verifying role", async () => {
    const html = normalize(await renderDetail());
    expect(html).toContain("Payment claims");
    // All three statuses with clear labels.
    expect(html).toContain("Awaiting verification");
    expect(html).toContain("Confirmed");
    expect(html).toContain("Rejected");
    // Claimed amounts, method labels, reference when present.
    expect(html).toContain("₹600");
    expect(html).toContain("₹200");
    expect(html).toContain("UPI");
    expect(html).toContain("Cash");
    expect(html).toContain("UTR-CLAIM-1");
    // Confirmed amount shown for the confirmed claim (differs from claimed).
    expect(html).toContain("₹550");
    // Submitted in Asia/Kolkata (04:30Z = 10:00 IST).
    expect(html).toContain("12 Oct 2026, 10:00 am");
    expect(mockListClaimsForMember).toHaveBeenCalledWith(
      "staff-1",
      "member-visible-1",
    );
  });

  it("states plainly that pending claims are not counted as paid", async () => {
    const html = normalize(await renderDetail());
    expect(html).toContain(
      "A claim counts as paid only after the gym verifies it — pending claims are not included in the paid total above.",
    );
  });

  it("renders no internal IDs as visible text", async () => {
    const html = normalize(await renderDetail());
    expect(html).not.toContain("claim-secret-pending");
    expect(html).not.toContain("claim-secret-confirmed");
    expect(html).not.toContain("claim-secret-rejected");
    expect(html).not.toContain("payment-secret-1");
    expect(html).not.toContain("membership-secret-1");
    expect(html).not.toContain("org-secret");
  });

  it("shows the empty state when the member has no claims", async () => {
    mockListClaimsForMember.mockResolvedValue({ items: [], truncated: false });
    const html = normalize(await renderDetail());
    expect(html).toContain("Payment claims");
    expect(html).toContain("No payment claims from this member yet.");
  });

  it("hides the section from roles that cannot verify claims and never calls the service", async () => {
    const html = normalize(await renderDetail("TRAINER"));
    expect(html).not.toContain("Payment claims");
    expect(html).not.toContain("Awaiting verification");
    expect(mockListClaimsForMember).not.toHaveBeenCalled();
    // The rest of the page is unaffected.
    expect(html).toContain("Asha Rao");
    expect(html).toContain("Financial");
  });

  it("a service denial hides the section without breaking the page", async () => {
    mockListClaimsForMember.mockRejectedValue(
      new PaymentClaimAuthorizationError("Staff role may not verify claims."),
    );
    const html = normalize(await renderDetail());
    expect(html).not.toContain("Payment claims");
    expect(html).toContain("Asha Rao");
    expect(html).toContain("Attendance");
  });

  it("keeps the existing page intact alongside the history", async () => {
    const html = normalize(await renderDetail());
    expect(html).toContain("Asha Rao");
    expect(html).toContain("Membership");
    expect(html).toContain("₹1,000"); // fee
    expect(html).toContain("₹500"); // paid total (confirmed amount is ₹550)
    expect(html).toContain("No payments recorded yet.");
    expect(html).toContain("Attendance");
    expect(html).toContain("Back to members");
  });
});

const DETAIL_WITH_REVERSALS: MemberDetail = {
  ...DETAIL,
  membership: {
    ...DETAIL.membership!,
    paidPaise: 20_000,
    outstandingPaise: 80_000,
    payments: [
      {
        id: "payment-full-1",
        amountPaise: 50_000,
        paymentMethod: "UPI",
        reference: "UTR-FULL",
        confirmedAt: "2026-10-05T04:30:00.000Z",
        confirmedByRole: "OWNER",
        reversedPaise: 50_000,
        remainingReversiblePaise: 0,
      },
      {
        id: "payment-part-1",
        amountPaise: 25_000,
        paymentMethod: "CASH",
        reference: null,
        confirmedAt: "2026-10-06T04:30:00.000Z",
        confirmedByRole: "ADMIN",
        reversedPaise: 5_000,
        remainingReversiblePaise: 20_000,
      },
    ],
    reversals: [
      {
        id: "reversal-secret-1",
        paymentId: "payment-full-1",
        amountPaise: 50_000,
        reason: "DUPLICATE_ENTRY",
        explanation: "Recorded twice",
        reversedAt: "2026-10-07T04:30:00.000Z",
        reversedByRole: "OWNER",
      },
      {
        id: "reversal-secret-2",
        paymentId: "payment-part-1",
        amountPaise: 5_000,
        reason: "WRONG_AMOUNT",
        explanation: null,
        reversedAt: "2026-10-08T04:30:00.000Z",
        reversedByRole: "ADMIN",
      },
    ],
  },
};

describe("member detail — payment reversals", () => {
  beforeEach(() => {
    mockGetMemberDetail.mockResolvedValue(DETAIL_WITH_REVERSALS);
  });

  it("shows reversed amounts per receipt, the Fully reversed state, and a disabled action with its reason", async () => {
    const html = normalize(await renderDetail());
    // Gross receipts stay visible alongside their reversed totals.
    expect(html).toContain("₹500");
    expect(html).toContain("₹250");
    expect(html).toContain("₹50");
    // Fully reversed receipt: badge + disabled Reverse + explanation.
    expect(html).toContain("Fully reversed");
    expect(html).toContain("Fully reversed — nothing left to reverse.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Reverse\s*<\/button>/);
    // Partially reversed receipt keeps a working Reverse link.
    expect(html).toContain(
      'href="/app/org/members/member-visible-1/payments/payment-part-1/reverse"',
    );
  });

  it("lists reversals separately with raw reason, explanation, and actor role", async () => {
    const html = normalize(await renderDetail());
    expect(html).toContain("Reversals");
    expect(html).toContain("DUPLICATE_ENTRY");
    expect(html).toContain("WRONG_AMOUNT");
    expect(html).toContain("Recorded twice");
    // Paid is disclosed as net of reversals.
    expect(html).toContain("Paid is net of reversals — see Reversals below.");
    // Internal reversal IDs are never visible text.
    expect(html).not.toContain("reversal-secret-1");
    expect(html).not.toContain("reversal-secret-2");
  });

  it("hides the Reverse action column from roles that cannot reverse, while history stays readable", async () => {
    mockGetMemberDetail.mockResolvedValue({
      ...DETAIL_WITH_REVERSALS,
      permissions: {
        ...DETAIL_WITH_REVERSALS.permissions,
        canReversePayment: false,
      },
    });
    const html = normalize(await renderDetail("STAFF"));
    expect(html).not.toContain("/reverse\"");
    expect(html).not.toContain("Fully reversed — nothing left to reverse.");
    // Reversal history itself remains visible to member-detail viewers.
    expect(html).toContain("DUPLICATE_ENTRY");
    expect(html).toContain("Fully reversed");
  });

  it("shows the empty state when nothing has been reversed", async () => {
    mockGetMemberDetail.mockResolvedValue(DETAIL);
    const html = normalize(await renderDetail());
    expect(html).not.toContain("Fully reversed");
    expect(html).toContain("No reversals recorded.");
  });
});

describe("member detail — unknown or foreign member", () => {
  it("still 404s via notFound and never attempts the claims read", async () => {
    mockGetMemberDetail.mockResolvedValue(null);
    setContext("OWNER");
    await expect(
      MemberDetailPage({ params: Promise.resolve({ id: "foreign-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockListClaimsForMember).not.toHaveBeenCalled();
  });
});

describe("member detail — truncated histories (M1)", () => {
  it("shows a latest-50 notice under each truncated table and none otherwise", async () => {
    mockGetMemberDetail.mockResolvedValue({
      ...DETAIL_WITH_REVERSALS,
      membership: {
        ...DETAIL_WITH_REVERSALS.membership!,
        paymentsTruncated: true,
        reversalsTruncated: true,
      },
    });
    mockListClaimsForMember.mockResolvedValue({
      items: CLAIMS,
      truncated: true,
    });
    const html = normalize(await renderDetail());
    expect(html).toContain("only the tables below are shortened");
    expect(html.match(/Showing the latest 50 records\./g)).toHaveLength(3);
  });

  it("shows no truncation notice when every history fits", async () => {
    const html = normalize(await renderDetail());
    expect(html).not.toContain("Showing the latest");
  });
});

describe("member detail — renewal section", () => {
  it("renders the renewal form for a role that may renew, wired to the current period", async () => {
    const html = normalize(await renderDetail());
    expect(html).toContain("Renew membership");
    expect(html).toContain("Renew membership form");
    expect(html).toContain('data-member="member-visible-1"');
    expect(html).toContain('data-plan="MONTHLY"');
    expect(html).toContain('data-fee="100000"');
    expect(html).toContain('data-pending="0"');
    // A suggested expiry is always supplied.
    expect(html).toMatch(/data-expiry="\d{4}-\d{2}-\d{2}"/);
  });

  it("passes the pending-claim count through to the form", async () => {
    mockGetMemberDetail.mockResolvedValue({
      ...DETAIL,
      membership: { ...DETAIL.membership!, pendingClaimsCount: 3 },
    });
    const html = normalize(await renderDetail());
    expect(html).toContain('data-pending="3"');
  });

  it("hides the renewal form when the role may not renew", async () => {
    mockGetMemberDetail.mockResolvedValue({
      ...DETAIL,
      permissions: { ...DETAIL.permissions, canRenewMembership: false },
    });
    const html = normalize(await renderDetail("TRAINER"));
    expect(html).not.toContain("Renew membership form");
    expect(html).not.toContain('aria-label="Renew membership"');
    // The rest of the page is unaffected.
    expect(html).toContain("Asha Rao");
    expect(html).toContain("Membership");
  });

  it("hides the renewal form when there is no current membership", async () => {
    mockGetMemberDetail.mockResolvedValue({ ...DETAIL, membership: null });
    const html = normalize(await renderDetail());
    expect(html).not.toContain("Renew membership form");
    expect(html).toContain("No membership on record.");
  });
});

const DETAIL_WITH_PAST: MemberDetail = {
  ...DETAIL,
  pastMemberships: [
    {
      id: "membership-secret-past",
      plan: "THREE_MONTHS",
      planLabel: "3 Months",
      startDate: "2025-10-01",
      expiryDate: "2026-01-01",
      feePaise: 250_000,
      paidPaise: 250_000,
      outstandingPaise: 0,
      membershipStatus: "EXPIRED",
      paymentStatus: "PAID",
      pendingClaimsCount: 1,
      payments: [
        {
          id: "payment-secret-past",
          amountPaise: 250_000,
          paymentMethod: "UPI",
          reference: "UTR-PAST-1",
          confirmedAt: "2025-10-01T04:30:00.000Z",
          confirmedByRole: "OWNER",
          reversedPaise: 0,
          remainingReversiblePaise: 250_000,
        },
      ],
      paymentsTruncated: false,
      reversals: [],
      reversalsTruncated: false,
    },
  ],
};

describe("member detail — past memberships", () => {
  beforeEach(() => {
    mockGetMemberDetail.mockResolvedValue(DETAIL_WITH_PAST);
  });

  it("renders past periods read-only with their own balances and payment history", async () => {
    const html = normalize(await renderDetail());
    expect(html).toContain("Past memberships");
    expect(html).toContain("3 Months");
    expect(html).toContain("01/10/2025");
    expect(html).toContain("01/01/2026");
    expect(html).toContain("₹2,500");
    expect(html).toContain("UTR-PAST-1");
    expect(html).toContain(
      "amounts never carry over between periods",
    );
    // Read-only: no Reverse link for the past period's payments, and
    // no internal IDs as visible text.
    expect(html).not.toContain(
      "/payments/payment-secret-past/reverse",
    );
    expect(html).not.toContain("membership-secret-past");
    expect(html).not.toContain("payment-secret-past");
  });

  it("is absent when the member has only one period", async () => {
    mockGetMemberDetail.mockResolvedValue(DETAIL);
    const html = normalize(await renderDetail());
    expect(html).not.toContain("Past memberships");
  });

  it("shows the bounded-history notice when older periods were cut", async () => {
    mockGetMemberDetail.mockResolvedValue({
      ...DETAIL_WITH_PAST,
      pastMembershipsTruncated: true,
    });
    const html = normalize(await renderDetail());
    expect(html).toContain("Showing the 10 most recent past periods.");
  });
});
