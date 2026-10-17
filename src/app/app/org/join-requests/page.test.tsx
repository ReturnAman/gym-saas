import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Join-requests page (server component): role gating, gym naming,
 * row mapping into the decision manager, and the empty state. The
 * organization context and the join-request service are mocked with
 * the REAL role helper and error classes (importActual); the client
 * manager is stubbed to capture its props so the server-computed
 * rows can be asserted exactly — including that TRAINER never
 * receives the manager at all.
 */

const { mockContext, mockListPending, managerProps } = vi.hoisted(() => ({
  mockContext: vi.fn(),
  mockListPending: vi.fn(),
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

vi.mock("@/lib/server/member-join-requests", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/server/member-join-requests")>(
      "@/lib/server/member-join-requests",
    );
  return { ...actual, listPendingJoinRequests: mockListPending };
});

vi.mock("./join-requests-manager", () => ({
  JoinRequestsManager: (props: unknown) => {
    managerProps.current = props;
    return <div data-testid="join-requests-manager" />;
  },
}));

import {
  MemberJoinRequestAuthorizationError,
  type MemberJoinRequestView,
} from "@/lib/server/member-join-requests";

import JoinRequestsPage from "./page";

const REQUEST_VIEW: MemberJoinRequestView = {
  id: "request-1",
  name: "Asha Rao",
  phoneNumber: "9000000021",
  requestedPlan: "MONTHLY",
  proposedFeePaise: 150_000,
  proposedStartDate: "2026-11-01T00:00:00.000Z",
  submittedAt: "2026-10-17T04:30:00.000Z",
};

function contextWithRole(role: string) {
  return {
    user: { id: "user-1" },
    membership: { organizationId: "org-1", role },
    organization: { id: "org-1", name: "Queue Gym" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  managerProps.current = null;
  mockContext.mockResolvedValue(contextWithRole("OWNER"));
  mockListPending.mockResolvedValue({
    requests: [REQUEST_VIEW],
    totalPending: 1,
  });
});

describe("JoinRequestsPage", () => {
  it("names the gym and maps the pending requests for the manager", async () => {
    const html = renderToString(await JoinRequestsPage());
    expect(html).toContain("Queue Gym");
    expect(html).toContain("join-requests-manager");
    expect(managerProps.current).toEqual({
      requests: [
        {
          id: "request-1",
          name: "Asha Rao",
          phoneNumber: "9000000021",
          requestedPlan: "MONTHLY",
          proposedFeePaise: 150_000,
          proposedStartDate: "2026-11-01T00:00:00.000Z",
          submittedAt: "2026-10-17T04:30:00.000Z",
        },
      ],
    });
    expect(mockListPending).toHaveBeenCalledWith("user-1");
  });

  it("renders the empty state when nothing is waiting", async () => {
    mockListPending.mockResolvedValue({ requests: [], totalPending: 0 });
    const html = renderToString(await JoinRequestsPage());
    expect(html).toContain("No pending requests");
    expect(html).not.toContain("join-requests-manager");
    expect(managerProps.current).toBeNull();
  });

  it("gives TRAINER the no-access state and never the manager", async () => {
    mockContext.mockResolvedValue(contextWithRole("TRAINER"));
    const html = renderToString(await JoinRequestsPage());
    expect(html).toContain("don’t have permission to view join requests");
    expect(html).not.toContain("join-requests-manager");
    expect(managerProps.current).toBeNull();
    expect(mockListPending).not.toHaveBeenCalled();
  });

  it("falls back to no-access if the service denies despite the role pre-check", async () => {
    mockListPending.mockRejectedValue(
      new MemberJoinRequestAuthorizationError("denied"),
    );
    const html = renderToString(await JoinRequestsPage());
    expect(html).toContain("don’t have permission to view join requests");
    expect(managerProps.current).toBeNull();
  });
});
