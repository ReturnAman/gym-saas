import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route contract for GET /api/ready (readiness probe) and its
 * separation from GET /api/health (liveness), with the pooled
 * database client and the logger mocked:
 * - DB reachable → 200 { service, status: "ready" }.
 * - DB failure (connection class) → 503 with exactly the shared
 *   DATABASE_UNAVAILABLE_BODY, logged once as a database failure,
 *   with no raw error text in the response.
 * - Unexpected failure → still 503 with the same generic body,
 *   logged once as an unexpected error (readiness is binary).
 * - /api/health stays 200 without touching the database at all,
 *   pinning the liveness/readiness separation.
 */
const { mockQueryRaw, mockLogDatabaseFailure, mockLogUnexpectedError } =
  vi.hoisted(() => ({
    mockQueryRaw: vi.fn(),
    mockLogDatabaseFailure: vi.fn(),
    mockLogUnexpectedError: vi.fn(),
  }));

vi.mock("@/lib/server/db", () => ({
  db: { $queryRaw: mockQueryRaw },
}));

vi.mock("@/lib/server/logger", () => ({
  logDatabaseFailure: mockLogDatabaseFailure,
  logUnexpectedError: mockLogUnexpectedError,
}));

import { GET as healthGET } from "@/app/api/health/route";
import { GET as readyGET } from "@/app/api/ready/route";
import { DATABASE_UNAVAILABLE_BODY } from "@/lib/server/db-errors";

function getRequest(path: string) {
  return new Request(`https://gym.example.com${path}`, {
    method: "GET",
    headers: { host: "gym.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);
});

describe("GET /api/ready", () => {
  it("returns 200 ready when the database answers SELECT 1", async () => {
    const response = await readyGET(getRequest("/api/ready"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "gym-saas",
      status: "ready",
    });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(mockLogDatabaseFailure).not.toHaveBeenCalled();
    expect(mockLogUnexpectedError).not.toHaveBeenCalled();
  });

  it("returns 503 with the shared body on a database connection failure", async () => {
    mockQueryRaw.mockRejectedValue(
      Object.assign(
        new Error("Can't reach database server at db.internal:5432"),
        { code: "P1001" },
      ),
    );
    const response = await readyGET(getRequest("/api/ready"));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual(DATABASE_UNAVAILABLE_BODY);
    expect(text).not.toContain("db.internal");
    expect(text).not.toContain("P1001");
    expect(mockLogDatabaseFailure).toHaveBeenCalledTimes(1);
    expect(mockLogUnexpectedError).not.toHaveBeenCalled();
  });

  it("returns the same generic 503 on an unexpected failure", async () => {
    mockQueryRaw.mockRejectedValue(
      new Error("totally unexpected internal detail"),
    );
    const response = await readyGET(getRequest("/api/ready"));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual(DATABASE_UNAVAILABLE_BODY);
    expect(text).not.toContain("totally unexpected");
    expect(mockLogUnexpectedError).toHaveBeenCalledTimes(1);
    expect(mockLogDatabaseFailure).not.toHaveBeenCalled();
  });
});

describe("GET /api/health (liveness, independent of readiness)", () => {
  it("returns 200 without touching the database, even when the DB is down", async () => {
    mockQueryRaw.mockRejectedValue(new Error("database is down"));
    const response = await healthGET(getRequest("/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "gym-saas",
      status: "ok",
    });
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});
