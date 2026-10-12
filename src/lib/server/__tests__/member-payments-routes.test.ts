import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetMemberContext, mockSubmitPaymentClaim } = vi.hoisted(() => ({
  mockGetMemberContext: vi.fn(),
  mockSubmitPaymentClaim: vi.fn(),
}));

// The real member-session module is loaded (the origin guard under test
// is the production one) with only the cookie-reading context resolver
// replaced. The real payment-claims module supplies the error classes
// and the REAL memberClaimScope translation — only the submission
// itself is stubbed. db/auth are stubbed so module loading stays inert.
vi.mock("@/lib/server/db", () => ({
  db: { organization: { findUnique: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/server/member-session", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/server/member-session")>();
  return { ...original, getMemberContext: mockGetMemberContext };
});
vi.mock("@/lib/server/payment-claims", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/server/payment-claims")>();
  return { ...original, submitPaymentClaim: mockSubmitPaymentClaim };
});

import { POST } from "@/app/api/member-payments/claims/route";
import { PaymentValidationError } from "@/lib/members";
import {
  PaymentClaimDuplicateError,
  PaymentClaimLimitError,
  PaymentClaimNotFoundError,
} from "@/lib/server/payment-claims";
import type { MemberSessionContext } from "@/lib/server/member-session";

const ORG_ID = "org-a";

function contextFixture(
  member: { id: string } | null = { id: "member-1" },
): MemberSessionContext {
  return {
    session: { id: "session-1", organizationId: ORG_ID },
    user: { id: "user-1" },
    organization: { id: ORG_ID, name: "Gym A" },
    membership: { organizationId: ORG_ID, role: "MEMBER" },
    member: member ? { id: member.id, name: "Test Member" } : null,
  } as unknown as MemberSessionContext;
}

function claimRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://gym.example.com/api/member-payments/claims", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "gym.example.com",
      origin: "https://gym.example.com",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_BODY = { amount: "500", paymentMethod: "UPI", reference: "UTR1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMemberContext.mockResolvedValue(contextFixture());
  mockSubmitPaymentClaim.mockResolvedValue({ claimId: "claim-1" });
});

describe("POST /api/member-payments/claims", () => {
  it("rejects a cross-origin request before resolving the session", async () => {
    const response = await POST(
      claimRequest(VALID_BODY, { origin: "https://evil.example.com" }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(mockGetMemberContext).not.toHaveBeenCalled();
    expect(mockSubmitPaymentClaim).not.toHaveBeenCalled();
  });

  it("requires a member session", async () => {
    mockGetMemberContext.mockResolvedValue(null);
    const response = await POST(claimRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    expect(mockSubmitPaymentClaim).not.toHaveBeenCalled();
  });

  it("refuses a session with no linked member record", async () => {
    mockGetMemberContext.mockResolvedValue(contextFixture(null));
    const response = await POST(claimRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect(mockSubmitPaymentClaim).not.toHaveBeenCalled();
  });

  it("submits with the session-derived scope and ignores body identity fields", async () => {
    const response = await POST(
      claimRequest({
        ...VALID_BODY,
        organizationId: "org-b",
        memberId: "member-999",
        userId: "user-999",
        membershipId: "membership-999",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.result).toBe("claim_submitted");
    expect(body.claimId).toBe("claim-1");
    expect(mockSubmitPaymentClaim).toHaveBeenCalledTimes(1);
    expect(mockSubmitPaymentClaim).toHaveBeenCalledWith(
      { userId: "user-1", organizationId: ORG_ID, memberId: "member-1" },
      { amount: "500", paymentMethod: "UPI", reference: "UTR1" },
    );
  });

  it("defaults a missing reference to an empty string", async () => {
    const response = await POST(
      claimRequest({ amount: "500", paymentMethod: "CASH" }),
    );
    expect(response.status).toBe(201);
    expect(mockSubmitPaymentClaim).toHaveBeenCalledWith(expect.anything(), {
      amount: "500",
      paymentMethod: "CASH",
      reference: "",
    });
  });

  it("rejects malformed JSON with a generic failure", async () => {
    const response = await POST(claimRequest("{not json"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("CLAIM_FAILED");
    expect(mockSubmitPaymentClaim).not.toHaveBeenCalled();
  });

  it("rejects a body without amount and method as a validation error", async () => {
    const response = await POST(claimRequest({ reference: "x" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mockSubmitPaymentClaim).not.toHaveBeenCalled();
  });

  it("maps service validation failures to 400 with the field message", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(
      new PaymentValidationError({
        amount: "Amount must be a valid amount, for example 6000 or 6000.50.",
      }),
    );
    const response = await POST(
      claimRequest({ amount: "abc", paymentMethod: "UPI", reference: "" }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("valid amount");
  });

  it("maps a duplicate pending claim to 409", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(
      new PaymentClaimDuplicateError("duplicate"),
    );
    const response = await POST(claimRequest(VALID_BODY));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("DUPLICATE_CLAIM");
  });

  it("maps the pending-claim cap to 409", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(
      new PaymentClaimLimitError("limit"),
    );
    const response = await POST(claimRequest(VALID_BODY));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(
      "TOO_MANY_PENDING_CLAIMS",
    );
  });

  it("maps a missing membership to the generic front-desk failure", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(
      new PaymentClaimNotFoundError("This member has no membership to pay against."),
    );
    const response = await POST(claimRequest(VALID_BODY));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("CLAIM_FAILED");
    expect(body.error.message).toContain("front desk");
  });

  it("returns a generic 500 for unexpected failures without leaking details", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(
      new Error("database connection string leaked here"),
    );
    const response = await POST(claimRequest(VALID_BODY));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("database");
  });
});
