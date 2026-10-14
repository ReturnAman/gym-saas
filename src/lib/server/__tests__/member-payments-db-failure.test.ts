import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

const { mockGetMemberContext, mockSubmitPaymentClaim } = vi.hoisted(() => ({
  mockGetMemberContext: vi.fn(),
  mockSubmitPaymentClaim: vi.fn(),
}));

// Same harness as member-payments-routes.test.ts: the real route,
// origin guard, session translation and error classes — only the
// submission is stubbed, here to fail the way the database does (H2).
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
import type { MemberSessionContext } from "@/lib/server/member-session";

const ORG_ID = "org-a";

function contextFixture(): MemberSessionContext {
  return {
    session: { id: "session-1", organizationId: ORG_ID },
    user: { id: "user-1" },
    organization: { id: ORG_ID, name: "Gym A" },
    membership: { organizationId: ORG_ID, role: "MEMBER" },
    member: { id: "member-1", name: "Test Member" },
  } as unknown as MemberSessionContext;
}

function claimRequest(headers: Record<string, string> = {}) {
  return new Request("https://gym.example.com/api/member-payments/claims", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "gym.example.com",
      origin: "https://gym.example.com",
      ...headers,
    },
    body: JSON.stringify({ amount: "500", paymentMethod: "UPI" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy.mockClear();
  mockGetMemberContext.mockResolvedValue(contextFixture());
});

describe("POST /api/member-payments/claims — database failures (H2)", () => {
  it("maps an unreachable database to 503 DATABASE_UNAVAILABLE without internals", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        "Can't reach database server at 127.0.0.1:5432",
        { code: "P1001", clientVersion: "7.10.0" },
      ),
    );
    const response = await POST(claimRequest());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("P1001");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("Can't reach database server");
  });

  it("maps a statement timeout to the same safe 503", async () => {
    const timeout = new Error("canceling statement due to statement timeout");
    mockSubmitPaymentClaim.mockRejectedValue(timeout);
    const response = await POST(claimRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("DATABASE_UNAVAILABLE");
  });

  it("keeps the existing 500 INTERNAL_ERROR for unexpected failures", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(new Error("totally unexpected"));
    const response = await POST(claimRequest());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("totally unexpected");
  });

  it("echoes a valid correlation ID on the failure response and in the log line (H3)", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
        code: "P1001",
        clientVersion: "7.10.0",
      }),
    );
    const response = await POST(
      claimRequest({ "x-request-id": "support-ref-12345678" }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("support-ref-12345678");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(
      errorSpy.mock.calls[0]?.[0] as string,
    ) as Record<string, string>;
    expect(record.event).toBe("database_unavailable");
    expect(record.boundary).toBe("POST /api/member-payments/claims");
    expect(record.requestId).toBe("support-ref-12345678");
    expect(record.errorKind).toBe("connection");
  });

  it("generates a correlation ID when the incoming one is invalid, and logs unexpected errors once (H3)", async () => {
    mockSubmitPaymentClaim.mockRejectedValue(new Error("surprise"));
    const response = await POST(claimRequest({ "x-request-id": "bad id!" }));
    expect(response.status).toBe(500);
    const echoed = response.headers.get("x-request-id");
    expect(echoed).not.toBe("bad id!");
    expect(echoed).toMatch(/^[0-9a-f-]{36}$/);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(
      errorSpy.mock.calls[0]?.[0] as string,
    ) as Record<string, string>;
    expect(record.event).toBe("unexpected_error");
    expect(record.requestId).toBe(echoed);
  });

  it("does not log expected business failures (H3 boundary discipline)", async () => {
    const { PaymentClaimDuplicateError } =
      await import("@/lib/server/payment-claims");
    mockSubmitPaymentClaim.mockRejectedValue(new PaymentClaimDuplicateError());
    const response = await POST(claimRequest());
    expect(response.status).toBe(409);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
