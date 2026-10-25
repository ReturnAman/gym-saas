import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQueryRaw } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: { $queryRaw: mockQueryRaw },
}));

import { GET } from "@/app/api/ready/route";

function readyRequest() {
  return new Request("https://gym.example.com/api/ready");
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/ready", () => {
  it("returns ready only after the database query succeeds", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET(readyRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "gym-saas",
      status: "ready",
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns a safe 503 when the database cannot be reached", async () => {
    mockQueryRaw.mockRejectedValue(
      new Error("database host db.example.internal password=sensitive"),
    );

    const response = await GET(readyRequest());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      service: "gym-saas",
      status: "not_ready",
    });
    expect(body).not.toContain("db.example.internal");
    expect(body).not.toContain("sensitive");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
