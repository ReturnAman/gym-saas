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

vi.mock("@/lib/server/authorization", () => ({
  requireOrganizationContext: mockRequireContext,
}));

vi.mock("@/lib/server/members", () => ({
  getMemberDetail: mockGetMemberDetail,
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
    payments: [],
  },
  permissions: {
    canView: true,
    canCreate: false,
    canEdit: true,
    canRecordPayment: true,
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
  mockListClaimsForMember.mockResolvedValue(CLAIMS);
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
    mockListClaimsForMember.mockResolvedValue([]);
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
