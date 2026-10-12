import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Payment claims page (server component): role gating, gym naming,
 * row mapping, and the empty state. The organization context and the
 * claim service are mocked with the REAL role helper and error
 * classes (importActual); the client manager is stubbed to capture
 * its props so the server-computed rows can be asserted exactly.
 */

const { mockContext, mockListReview, managerProps } = vi.hoisted(() => ({
  mockContext: vi.fn(),
  mockListReview: vi.fn(),
  managerProps: { current: null as unknown },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/server/authorization", () => ({
  requireOrganizationContext: mockContext,
}));

vi.mock("@/lib/server/payment-claims", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/server/payment-claims")>(
      "@/lib/server/payment-claims",
    );
  return { ...actual, listPendingClaimsForReview: mockListReview };
});

vi.mock("./claims-manager", () => ({
  ClaimsManager: (props: unknown) => {
    managerProps.current = props;
    return <div data-testid="claims-manager" />;
  },
}));

import {
  PaymentClaimAuthorizationError,
  type PendingClaimReviewView,
} from "@/lib/server/payment-claims";

import PaymentClaimsPage from "./page";

const REVIEW_VIEW: PendingClaimReviewView = {
  id: "claim-1",
  memberId: "member-1",
  membershipId: "membership-1",
  claimedAmountPaise: 60_000,
  paymentMethod: "UPI",
  reference: "UTR123",
  status: "PENDING",
  submittedAt: "2026-10-12T04:30:00.000Z",
  verifiedAt: null,
  paymentId: null,
  confirmedAmountPaise: null,
  memberName: "Asha Rao",
  memberPhoneNumber: "9000000021",
  membershipPlan: "MONTHLY",
  membershipFeePaise: 100_000,
  membershipExpiryDate: "2026-02-01T00:00:00.000Z",
  paidPaise: 40_000,
  outstandingPaise: 60_000,
};

function contextWithRole(role: string) {
  return {
    user: { id: "user-1" },
    membership: { organizationId: "org-1", role },
    organization: { id: "org-1", name: "Review Gym" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  managerProps.current = null;
  mockContext.mockResolvedValue(contextWithRole("OWNER"));
  mockListReview.mockResolvedValue([REVIEW_VIEW]);
});

describe("PaymentClaimsPage", () => {
  it("names the gym and maps review rows for the manager", async () => {
    const html = renderToString(await PaymentClaimsPage());
    expect(html).toContain("Review Gym");
    expect(html).toContain("Payment claims");
    const props = managerProps.current as {
      claims: Array<Record<string, unknown>>;
    };
    expect(props.claims).toHaveLength(1);
    expect(props.claims[0]).toMatchObject({
      id: "claim-1",
      memberName: "Asha Rao",
      memberPhoneNumber: "9000000021",
      membershipPlan: "MONTHLY",
      claimedAmountPaise: 60_000,
      paidPaise: 40_000,
      outstandingPaise: 60_000,
    });
    expect(props.claims[0]).not.toHaveProperty("membershipId");
  });

  it("renders the empty state when nothing is waiting", async () => {
    mockListReview.mockResolvedValue([]);
    const html = renderToString(await PaymentClaimsPage());
    expect(html).toContain("No payments are waiting for verification.");
    expect(managerProps.current).toBeNull();
  });

  it.each(["OWNER", "ADMIN", "STAFF"])(
    "allows %s to load the queue",
    async (role) => {
      mockContext.mockResolvedValue(contextWithRole(role));
      const html = renderToString(await PaymentClaimsPage());
      expect(html).toContain("Review Gym");
      expect(mockListReview).toHaveBeenCalledWith("user-1");
    },
  );

  it.each(["TRAINER", "MEMBER"])(
    "shows the no-access state to %s without loading claims",
    async (role) => {
      mockContext.mockResolvedValue(contextWithRole(role));
      const html = renderToString(await PaymentClaimsPage());
      expect(html).toContain("don’t have permission");
      expect(mockListReview).not.toHaveBeenCalled();
    },
  );

  it("falls back to no-access if the service denies despite the role pre-check", async () => {
    mockListReview.mockRejectedValue(
      new PaymentClaimAuthorizationError("denied"),
    );
    const html = renderToString(await PaymentClaimsPage());
    expect(html).toContain("don’t have permission");
  });
});
