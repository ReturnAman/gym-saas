import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * dismissOfferPromptAction — OWNER authorization (Phase 3 fix 2).
 *
 * The offer prompt is an owner-facing commercial prompt: only the gym
 * owner may dismiss it. Staff and other roles keep their normal
 * application access — this check gates only the dismissal, never
 * their membership or their other pages.
 */

const {
  mockRequireCurrentUser,
  mockGetPrimaryMembership,
  mockDismissOfferPrompt,
  mockRedirect,
} = vi.hoisted(() => {
  const mockRedirect = (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  };
  return {
    mockRequireCurrentUser: vi.fn(),
    mockGetPrimaryMembership: vi.fn(),
    mockDismissOfferPrompt: vi.fn(),
    mockRedirect: vi.fn(mockRedirect),
  };
});

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/server/auth", () => ({
  requireCurrentUser: mockRequireCurrentUser,
}));
vi.mock("@/lib/server/authorization", () => ({
  getPrimaryMembership: mockGetPrimaryMembership,
  hasRole: (
    membership: { role: string },
    ...roles: string[]
  ) => roles.includes(membership.role),
}));
vi.mock("@/lib/server/platform-admin", () => ({
  acceptSaasOffer: vi.fn(),
  dismissOfferPrompt: mockDismissOfferPrompt,
  requestSaasOffer: vi.fn(),
}));

import { dismissOfferPromptAction } from "@/app/app/subscription/actions";

const USER = { id: "user-1" } as never;

function membership(role: string) {
  return { organizationId: "org-1", role } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCurrentUser.mockResolvedValue(USER);
  mockDismissOfferPrompt.mockResolvedValue(undefined);
});

describe("dismissOfferPromptAction", () => {
  it("dismisses the prompt for the OWNER and returns to the org area", async () => {
    mockGetPrimaryMembership.mockResolvedValue(membership("OWNER"));

    await expect(dismissOfferPromptAction()).rejects.toThrow(
      "NEXT_REDIRECT:/app/org",
    );
    expect(mockDismissOfferPrompt).toHaveBeenCalledWith("org-1");
    expect(mockDismissOfferPrompt).toHaveBeenCalledTimes(1);
  });

  it("refuses dismissal for non-OWNER roles without dismissing anything", async () => {
    mockGetPrimaryMembership.mockResolvedValue(membership("STAFF"));

    await expect(dismissOfferPromptAction()).rejects.toThrow(
      "/app/subscription?notice=",
    );
    expect(mockDismissOfferPrompt).not.toHaveBeenCalled();
  });

  it("sends users without a membership to onboarding", async () => {
    mockGetPrimaryMembership.mockResolvedValue(null);

    await expect(dismissOfferPromptAction()).rejects.toThrow(
      "NEXT_REDIRECT:/onboarding",
    );
    expect(mockDismissOfferPrompt).not.toHaveBeenCalled();
  });
});
