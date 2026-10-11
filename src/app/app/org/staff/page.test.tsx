import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Staff page (server component): access gating and row mapping.
 *
 * The organization context, the staff service, and the display-name
 * enrichment are mocked; the REAL permission helper and error classes
 * are used (importActual), so the page's gating logic runs against the
 * actual matrix. The client manager is stubbed to echo its props so
 * the server-computed row flags can be asserted exactly.
 */

const { mockContext, mockList, mockNames, managerProps } = vi.hoisted(() => ({
  mockContext: vi.fn(),
  mockList: vi.fn(),
  mockNames: vi.fn(),
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

vi.mock("@/lib/server/staff", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/server/staff")>(
      "@/lib/server/staff",
    );
  return { ...actual, listOrganizationStaff: mockList };
});

vi.mock("./display-names", () => ({
  getStaffDisplayNames: mockNames,
}));

vi.mock("./staff-manager", () => ({
  StaffManager: (props: unknown) => {
    managerProps.current = props;
    return <div data-testid="staff-manager" />;
  },
}));

import { StaffAuthorizationError } from "@/lib/server/staff";
import StaffPage from "./page";

const ORG = { id: "org-1", name: "Powerhouse Gym" };

function context(role: string, userId = "user-self") {
  return {
    user: { id: userId },
    membership: { role, organizationId: ORG.id },
    organization: ORG,
  };
}

function entry(userId: string, role: string, id: string) {
  return {
    id,
    userId,
    role,
    createdAt: new Date("2026-10-03T00:00:00Z"),
  };
}

interface CapturedProps {
  organizationName: string;
  grantableRoles: string[];
  canManageStaff: boolean;
  rows: {
    membershipId: string;
    displayName: string | null;
    role: string;
    isSelf: boolean;
    canManage: boolean;
  }[];
}

function captured(): CapturedProps {
  return managerProps.current as CapturedProps;
}

beforeEach(() => {
  vi.clearAllMocks();
  managerProps.current = null;
  mockNames.mockResolvedValue(new Map());
});

describe("StaffPage", () => {
  it("renders the gym name prominently with the primary-gym note", async () => {
    mockContext.mockResolvedValue(context("OWNER"));
    mockList.mockResolvedValue([entry("user-self", "OWNER", "mem-1")]);
    const html = renderToString(await StaffPage());
    expect(html).toContain("Powerhouse Gym");
    expect(html).toContain("primary gym");
    expect(captured().organizationName).toBe("Powerhouse Gym");
  });

  it("maps rows with server-computed flags for an OWNER", async () => {
    mockContext.mockResolvedValue(context("OWNER"));
    mockList.mockResolvedValue([
      entry("user-self", "OWNER", "mem-1"),
      entry("user-staff", "STAFF", "mem-2"),
      entry("user-admin", "ADMIN", "mem-3"),
    ]);
    mockNames.mockResolvedValue(
      new Map([
        ["user-self", "Olivia Owner"],
        ["user-staff", "Sam Staff"],
        ["user-admin", null],
      ]),
    );
    renderToString(await StaffPage());
    const rows = captured().rows;
    expect(rows).toHaveLength(3);
    const byRole = new Map(rows.map((r) => [r.role, r]));
    expect(byRole.get("OWNER")?.isSelf).toBe(true);
    expect(byRole.get("OWNER")?.canManage).toBe(false);
    expect(byRole.get("STAFF")?.canManage).toBe(true);
    expect(byRole.get("ADMIN")?.canManage).toBe(true);
    expect(byRole.get("STAFF")?.displayName).toBe("Sam Staff");
    expect(byRole.get("ADMIN")?.displayName).toBeNull();
    expect(captured().grantableRoles).toEqual(["ADMIN", "STAFF", "TRAINER"]);
    // Only membership IDs and labels cross to the client component —
    // no local user IDs, no Clerk IDs anywhere in the props.
    const serialized = JSON.stringify(captured());
    expect(serialized).not.toContain("user-staff");
    expect(serialized).not.toContain("user-self");
    expect(serialized.toLowerCase()).not.toContain("clerk");
  });

  it("denies an ADMIN any control over another ADMIN's row", async () => {
    mockContext.mockResolvedValue(context("ADMIN", "user-admin-self"));
    mockList.mockResolvedValue([
      entry("user-admin-self", "ADMIN", "mem-1"),
      entry("user-other-admin", "ADMIN", "mem-2"),
      entry("user-staff", "STAFF", "mem-3"),
    ]);
    renderToString(await StaffPage());
    const rows = captured().rows;
    const otherAdmin = rows.find((r) => r.membershipId === "mem-2");
    const staff = rows.find((r) => r.membershipId === "mem-3");
    expect(otherAdmin?.canManage).toBe(false);
    expect(staff?.canManage).toBe(true);
    expect(captured().grantableRoles).toEqual(["STAFF", "TRAINER"]);
  });

  it("renders a permission notice, without calling the service, for STAFF and TRAINER", async () => {
    for (const role of ["STAFF", "TRAINER"]) {
      mockContext.mockResolvedValue(context(role));
      const html = renderToString(await StaffPage());
      expect(html).toContain("permission to view staff");
      expect(html).toContain("Powerhouse Gym");
    }
    expect(mockList).not.toHaveBeenCalled();
  });

  it("renders the denied state if the service refuses the list", async () => {
    mockContext.mockResolvedValue(context("OWNER"));
    mockList.mockRejectedValue(
      new StaffAuthorizationError("You do not belong to an organization."),
    );
    const html = renderToString(await StaffPage());
    expect(html).toContain("permission to view staff");
    expect(html).toContain("You do not belong to an organization.");
  });

  it("lets unexpected failures reach the error boundary", async () => {
    mockContext.mockResolvedValue(context("OWNER"));
    mockList.mockRejectedValue(new Error("database down"));
    await expect(StaffPage()).rejects.toThrow("database down");
  });
});
