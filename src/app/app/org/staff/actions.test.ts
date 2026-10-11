import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Staff server actions: thin translators between form data and the
 * staff service. These tests pin the error-to-message mapping and,
 * critically, that the add action identifies the account by EMAIL
 * only — a client-supplied user ID can never reach the service.
 */

const {
  mockRequireCurrentUser,
  mockFindCandidate,
  mockAdd,
  mockChange,
  mockRevoke,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireCurrentUser: vi.fn(),
  mockFindCandidate: vi.fn(),
  mockAdd: vi.fn(),
  mockChange: vi.fn(),
  mockRevoke: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("@/lib/server/auth", () => ({
  requireCurrentUser: mockRequireCurrentUser,
}));

vi.mock("@/lib/server/staff", () => {
  class StaffAuthorizationError extends Error {}
  class StaffNotFoundError extends Error {
    constructor(message = "That staff member was not found in this gym.") {
      super(message);
    }
  }
  class StaffConflictError extends Error {}
  class StaffValidationError extends Error {}
  class StaffAccountNotFoundError extends Error {}
  class ClerkDirectoryUnavailableError extends Error {}
  return {
    STAFF_SIGN_IN_FIRST_MESSAGE:
      "No registered account was found for that email. Ask the person to sign in first, then try again.",
    StaffAuthorizationError,
    StaffNotFoundError,
    StaffConflictError,
    StaffValidationError,
    StaffAccountNotFoundError,
    ClerkDirectoryUnavailableError,
    findStaffCandidateByEmail: mockFindCandidate,
    addOrganizationStaff: mockAdd,
    changeOrganizationStaffRole: mockChange,
    revokeOrganizationStaffAccess: mockRevoke,
  };
});

import {
  ClerkDirectoryUnavailableError,
  StaffAccountNotFoundError,
  StaffAuthorizationError,
  StaffConflictError,
  StaffNotFoundError,
  StaffValidationError,
} from "@/lib/server/staff";
import {
  addStaffAction,
  changeStaffRoleAction,
  lookupStaffCandidateAction,
  revokeStaffAccessAction,
} from "./actions";
import {
  INITIAL_STAFF_LOOKUP_STATE,
  INITIAL_STAFF_MUTATION_STATE,
} from "./staff-action-state";

const ACTOR_ID = "actor-user-id";

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCurrentUser.mockResolvedValue({ id: ACTOR_ID });
});

describe("lookupStaffCandidateAction", () => {
  it("returns the candidate and echoes the form values", async () => {
    mockFindCandidate.mockResolvedValue({
      email: "person@example.com",
      displayName: "Pat Example",
      existingRole: null,
    });
    const state = await lookupStaffCandidateAction(
      INITIAL_STAFF_LOOKUP_STATE,
      formData({ email: "person@example.com", role: "TRAINER" }),
    );
    expect(mockFindCandidate).toHaveBeenCalledWith(
      ACTOR_ID,
      "person@example.com",
    );
    expect(state.ok).toBe(true);
    expect(state.candidate).toEqual({
      email: "person@example.com",
      displayName: "Pat Example",
      existingRole: null,
    });
    expect(state.role).toBe("TRAINER");
  });

  it("maps a missing account to the sign-in-first message", async () => {
    mockFindCandidate.mockRejectedValue(new StaffAccountNotFoundError());
    const state = await lookupStaffCandidateAction(
      INITIAL_STAFF_LOOKUP_STATE,
      formData({ email: "ghost@example.com", role: "STAFF" }),
    );
    expect(state.ok).toBe(false);
    expect(state.candidate).toBeNull();
    expect(state.message).toContain("sign in first");
  });

  it("maps a provider outage to a retry message", async () => {
    mockFindCandidate.mockRejectedValue(new ClerkDirectoryUnavailableError());
    const state = await lookupStaffCandidateAction(
      INITIAL_STAFF_LOOKUP_STATE,
      formData({ email: "person@example.com", role: "STAFF" }),
    );
    expect(state.message).toBe(
      "Account lookup is unavailable right now. Please try again.",
    );
  });

  it("surfaces validation errors from the service", async () => {
    mockFindCandidate.mockRejectedValue(
      new StaffValidationError("Enter a valid email address."),
    );
    const state = await lookupStaffCandidateAction(
      INITIAL_STAFF_LOOKUP_STATE,
      formData({ email: "nope", role: "STAFF" }),
    );
    expect(state.message).toBe("Enter a valid email address.");
  });
});

describe("addStaffAction", () => {
  it("adds by email and role only, then revalidates the page", async () => {
    mockAdd.mockResolvedValue({ id: "membership-id" });
    const state = await addStaffAction(
      INITIAL_STAFF_MUTATION_STATE,
      formData({ email: "person@example.com", role: "ADMIN" }),
    );
    expect(state.ok).toBe(true);
    expect(mockAdd).toHaveBeenCalledWith(ACTOR_ID, {
      email: "person@example.com",
      role: "ADMIN",
    });
    const input = mockAdd.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(["email", "role"]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/staff");
  });

  it("rejects OWNER and garbage roles before calling the service", async () => {
    for (const role of ["OWNER", "SUPERUSER", ""]) {
      const state = await addStaffAction(
        INITIAL_STAFF_MUTATION_STATE,
        formData({ email: "person@example.com", role }),
      );
      expect(state.ok).toBe(false);
      expect(state.message).toBe("Choose a valid role.");
    }
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("maps duplicate membership to the conflict message", async () => {
    mockAdd.mockRejectedValue(
      new StaffConflictError("That person already has access to this gym."),
    );
    const state = await addStaffAction(
      INITIAL_STAFF_MUTATION_STATE,
      formData({ email: "person@example.com", role: "STAFF" }),
    );
    expect(state.ok).toBe(false);
    expect(state.message).toBe("That person already has access to this gym.");
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("maps authorization failures to the service message", async () => {
    mockAdd.mockRejectedValue(
      new StaffAuthorizationError("You cannot grant that role."),
    );
    const state = await addStaffAction(
      INITIAL_STAFF_MUTATION_STATE,
      formData({ email: "person@example.com", role: "ADMIN" }),
    );
    expect(state.message).toBe("You cannot grant that role.");
  });
});

describe("changeStaffRoleAction and revokeStaffAccessAction", () => {
  it("changes a role by membership ID and revalidates", async () => {
    mockChange.mockResolvedValue({ id: "membership-id", role: "TRAINER" });
    const state = await changeStaffRoleAction(
      INITIAL_STAFF_MUTATION_STATE,
      formData({ membershipId: "membership-id", role: "TRAINER" }),
    );
    expect(state.ok).toBe(true);
    expect(mockChange).toHaveBeenCalledWith(ACTOR_ID, {
      membershipId: "membership-id",
      role: "TRAINER",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/staff");
  });

  it("still revalidates when the target vanished (stale list)", async () => {
    mockChange.mockRejectedValue(new StaffNotFoundError());
    const state = await changeStaffRoleAction(
      INITIAL_STAFF_MUTATION_STATE,
      formData({ membershipId: "gone", role: "STAFF" }),
    );
    expect(state.ok).toBe(false);
    expect(state.message).toBe(
      "That staff member was not found in this gym.",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/staff");
  });

  it("revokes by membership ID and revalidates", async () => {
    mockRevoke.mockResolvedValue({ id: "membership-id" });
    const state = await revokeStaffAccessAction(
      INITIAL_STAFF_MUTATION_STATE,
      formData({ membershipId: "membership-id" }),
    );
    expect(state.ok).toBe(true);
    expect(mockRevoke).toHaveBeenCalledWith(ACTOR_ID, {
      membershipId: "membership-id",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/staff");
  });
});
