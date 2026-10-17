import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route contract for POST /api/member-auth/join-request, with the
 * facade mocked: outcome → status/body mapping, the generic failure
 * (byte-identical for every challenge/context failure), validation
 * detail for the caller's own input, and the H2 database-failure
 * behaviour. The service itself has unit and database suites.
 */
const { mockSubmit, mockIsSameOrigin, MockJoinError, MockValidationError } =
  vi.hoisted(() => {
    class MockJoinError extends Error {
      constructor() {
        super("Join request failed.");
        this.name = "MemberJoinRequestError";
      }
    }
    class MockValidationError extends Error {
      fields: Record<string, string>;
      constructor(fields: Record<string, string>) {
        super("Join request validation failed.");
        this.name = "MemberJoinRequestValidationError";
        this.fields = fields;
      }
    }
    return {
      mockSubmit: vi.fn(),
      mockIsSameOrigin: vi.fn(),
      MockJoinError,
      MockValidationError,
    };
  });

vi.mock("@/lib/server/member-auth", () => ({
  submitMemberJoinRequest: mockSubmit,
}));
vi.mock("@/lib/server/member-join-requests", () => ({
  MemberJoinRequestError: MockJoinError,
  MemberJoinRequestValidationError: MockValidationError,
}));
vi.mock("@/lib/server/member-session", () => ({
  isSameOriginRequest: mockIsSameOrigin,
}));

import { POST as joinRequestPOST } from "@/app/api/member-auth/join-request/route";

const GENERIC_BODY = {
  error: {
    code: "JOIN_REQUEST_FAILED",
    message:
      "We could not send your request. Please request a new code and try again, or ask the gym for help.",
  },
};

function jsonRequest(body: unknown) {
  return new Request("https://gym.example.com/api/member-auth/join-request", {
    method: "POST",
    headers: { "content-type": "application/json", host: "gym.example.com" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  organizationId: "org-a",
  challengeId: "challenge-1",
  name: "New Person",
  requestedPlan: "MONTHLY",
  proposedFee: "1500",
  proposedStartDate: "2026-11-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSameOrigin.mockReturnValue(true);
});

describe("POST /api/member-auth/join-request", () => {
  it("returns 201 { requested: true } when a request is created", async () => {
    mockSubmit.mockResolvedValue({ status: "created", requestId: "req-1" });
    const response = await joinRequestPOST(jsonRequest(VALID_BODY));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ requested: true });
    expect(mockSubmit).toHaveBeenCalledWith({
      organizationId: "org-a",
      challengeId: "challenge-1",
      name: "New Person",
      requestedPlan: "MONTHLY",
      proposedFee: "1500",
      proposedStartDate: "2026-11-01",
    });
  });

  it("returns 200 with alreadyPending for a duplicate submission", async () => {
    mockSubmit.mockResolvedValue({
      status: "already_pending",
      requestId: "req-1",
    });
    const response = await joinRequestPOST(jsonRequest(VALID_BODY));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requested: true,
      alreadyPending: true,
    });
  });

  it("returns 409 ALREADY_REGISTERED when the number is already registered", async () => {
    mockSubmit.mockResolvedValue({ status: "already_registered" });
    const response = await joinRequestPOST(jsonRequest(VALID_BODY));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("ALREADY_REGISTERED");
  });

  it("returns 400 with per-field detail for the caller's own invalid input", async () => {
    mockSubmit.mockRejectedValue(
      new MockValidationError({
        fee: "Fee must be a valid amount, for example 6000 or 6000.50.",
        plan: "Choose a membership plan.",
      }),
    );
    const response = await joinRequestPOST(jsonRequest(VALID_BODY));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toEqual({
      fee: "Fee must be a valid amount, for example 6000 or 6000.50.",
      plan: "Choose a membership plan.",
    });
    expect(body.error.message).toContain("Choose a membership plan");
  });

  it("returns the identical generic body for unknown, consumed, and gym-mismatched challenges", async () => {
    mockSubmit.mockRejectedValue(new MockJoinError());
    const bodies: string[] = [];
    for (const challengeId of ["unknown-id", "consumed-id", "other-gym-id"]) {
      const response = await joinRequestPOST(
        jsonRequest({ ...VALID_BODY, challengeId }),
      );
      expect(response.status).toBe(400);
      bodies.push(await response.text());
    }
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[1]).toBe(bodies[2]);
    expect(JSON.parse(bodies[0]!)).toEqual(GENERIC_BODY);
  });

  it("rejects cross-origin requests and malformed bodies generically, without calling the service", async () => {
    mockIsSameOrigin.mockReturnValue(false);
    const cross = await joinRequestPOST(jsonRequest(VALID_BODY));
    expect(cross.status).toBe(400);
    expect(await cross.json()).toEqual(GENERIC_BODY);

    mockIsSameOrigin.mockReturnValue(true);
    const missing = await joinRequestPOST(
      jsonRequest({ organizationId: "org-a" }),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual(GENERIC_BODY);

    const notJson = await joinRequestPOST(
      new Request("https://gym.example.com/api/member-auth/join-request", {
        method: "POST",
        headers: { "content-type": "application/json", host: "gym.example.com" },
        body: "not json",
      }),
    );
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual(GENERIC_BODY);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("returns 503 DATABASE_UNAVAILABLE on a database failure (H2)", async () => {
    const { Prisma } = await import("@prisma/client");
    mockSubmit.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
        code: "P1001",
        clientVersion: "7.10.0",
      }),
    );
    const response = await joinRequestPOST(jsonRequest(VALID_BODY));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
  });
});
