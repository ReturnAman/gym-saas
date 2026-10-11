// @vitest-environment jsdom
/**
 * Behavioral tests for the staff manager component.
 *
 * The server actions are stubbed (their own behavior is covered in
 * actions.test.ts; authorization lives in the service suite). These
 * tests mount the real component and pin what the manager SEES and can
 * do: the role matrix as rendered, the candidate confirmation flow,
 * the two-step revoke, and that no internal identifiers (membership
 * IDs as visible text, user IDs, Clerk IDs) leak into the output.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SIGN_IN_FIRST =
  "No registered account was found for that email. Ask the person to sign in first, then try again.";

const { lookupStub, addStub, changeStub, revokeStub } = vi.hoisted(() => ({
  lookupStub: vi.fn(),
  addStub: vi.fn(),
  changeStub: vi.fn(),
  revokeStub: vi.fn(),
}));

vi.mock("./actions", () => ({
  lookupStaffCandidateAction: lookupStub,
  addStaffAction: addStub,
  changeStaffRoleAction: changeStub,
  revokeStaffAccessAction: revokeStub,
}));

import { StaffManager, type StaffRow } from "./staff-manager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const OWNER_ROWS: StaffRow[] = [
  {
    membershipId: "mem-self",
    displayName: "Olivia Owner",
    role: "OWNER",
    addedLabel: "Added 1 Sep 2026",
    isSelf: true,
    canManage: false,
  },
  {
    membershipId: "mem-staff",
    displayName: "Sam Staff",
    role: "STAFF",
    addedLabel: "Added 3 Oct 2026",
    isSelf: false,
    canManage: true,
  },
  {
    membershipId: "mem-trainer",
    displayName: null,
    role: "TRAINER",
    addedLabel: "Added 5 Oct 2026",
    isSelf: false,
    canManage: true,
  },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(element: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
}

async function submitForm(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

function rowByText(text: string): HTMLLIElement {
  const item = [...container!.querySelectorAll("li")].find((li) =>
    li.textContent?.includes(text),
  );
  if (!item) throw new Error(`row not found: ${text}`);
  return item as HTMLLIElement;
}

function buttonByText(scope: ParentNode, text: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  lookupStub.mockImplementation(
    async (_prev: unknown, formData: FormData) => {
      const email = String(formData.get("email") ?? "");
      const role = String(formData.get("role") ?? "STAFF");
      if (email === "found@example.com") {
        return {
          ok: true,
          message: null,
          email,
          role,
          candidate: {
            email,
            displayName: "Found Person",
            existingRole: null,
          },
        };
      }
      if (email === "member@example.com") {
        return {
          ok: true,
          message: null,
          email,
          role,
          candidate: {
            email,
            displayName: "Existing Member",
            existingRole: "TRAINER",
          },
        };
      }
      return {
        ok: false,
        message: SIGN_IN_FIRST,
        email,
        role,
        candidate: null,
      };
    },
  );
  addStub.mockResolvedValue({ ok: true, message: "Staff access added." });
  changeStub.mockResolvedValue({ ok: true, message: "Role updated." });
  revokeStub.mockResolvedValue({ ok: true, message: "Access revoked." });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
});

describe("StaffManager as OWNER", () => {
  it("renders staff rows with names, roles, and no internal IDs as text", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={OWNER_ROWS}
        grantableRoles={["ADMIN", "STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    const text = container!.textContent ?? "";
    expect(text).toContain("Olivia Owner");
    expect(text).toContain("(You)");
    expect(text).toContain("Sam Staff");
    expect(text).toContain("Name unavailable");
    expect(text).toContain("Added 3 Oct 2026");
    // Membership IDs exist only as hidden form values, never as text;
    // user IDs and Clerk IDs are not part of the props at all.
    expect(text).not.toContain("mem-self");
    expect(text).not.toContain("mem-staff");
    expect(text.toLowerCase()).not.toContain("clerk");
  });

  it("offers ADMIN, STAFF, and TRAINER in the add-role select", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={OWNER_ROWS}
        grantableRoles={["ADMIN", "STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    const select = container!.querySelector<HTMLSelectElement>("#staff-role");
    const options = [...select!.options].map((o) => o.textContent);
    expect(options).toEqual(["Admin", "Staff", "Trainer"]);
  });

  it("gives the self row and unmanageable rows no action controls", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={OWNER_ROWS}
        grantableRoles={["ADMIN", "STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    expect(rowByText("Olivia Owner").querySelectorAll("button")).toHaveLength(
      0,
    );
    const staffRow = rowByText("Sam Staff");
    expect(buttonByText(staffRow, "Change role")).toBeTruthy();
    expect(buttonByText(staffRow, "Revoke access")).toBeTruthy();
  });

  it("requires an explicit confirmation before revoking", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={OWNER_ROWS}
        grantableRoles={["ADMIN", "STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    const staffRow = rowByText("Sam Staff");
    await click(buttonByText(staffRow, "Revoke access"));
    expect(container!.textContent).toContain("lose staff access immediately");
    expect(revokeStub).not.toHaveBeenCalled();

    await click(buttonByText(staffRow, "Cancel"));
    expect(container!.textContent).not.toContain(
      "lose staff access immediately",
    );
    expect(revokeStub).not.toHaveBeenCalled();

    await click(buttonByText(staffRow, "Revoke access"));
    await click(buttonByText(staffRow, "Confirm revoke"));
    expect(revokeStub).toHaveBeenCalledTimes(1);
    const formData = revokeStub.mock.calls[0]?.[1] as FormData;
    expect(formData.get("membershipId")).toBe("mem-staff");
    expect(formData.get("userId")).toBeNull();
    // The success message only appears after the action resolves.
    expect(container!.textContent).toContain("Access revoked.");
  });

  it("looks up a candidate, shows the public fields, and adds by email", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={OWNER_ROWS}
        grantableRoles={["ADMIN", "STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    const emailInput =
      container!.querySelector<HTMLInputElement>("#staff-email")!;
    emailInput.value = "found@example.com";
    const lookupForm = emailInput.closest("form")!;
    await submitForm(lookupForm);

    expect(lookupStub).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain("Found Person");
    expect(container!.textContent).toContain("found@example.com");

    const addButton = buttonByText(container!, "Add to staff");
    await submitForm(addButton.closest("form")!);
    expect(addStub).toHaveBeenCalledTimes(1);
    const formData = addStub.mock.calls[0]?.[1] as FormData;
    expect(formData.get("email")).toBe("found@example.com");
    expect(formData.get("userId")).toBeNull();
    expect(container!.textContent).toContain("Staff access added.");
  });

  it("shows the existing role and no add button for an existing member", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={OWNER_ROWS}
        grantableRoles={["ADMIN", "STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    const emailInput =
      container!.querySelector<HTMLInputElement>("#staff-email")!;
    emailInput.value = "member@example.com";
    await submitForm(emailInput.closest("form")!);
    expect(container!.textContent).toContain("already has access");
    expect(container!.textContent).toContain("Trainer");
    expect(
      [...container!.querySelectorAll("button")].some(
        (b) => b.textContent?.trim() === "Add to staff",
      ),
    ).toBe(false);
    expect(addStub).not.toHaveBeenCalled();
  });

  it("shows the sign-in-first message for an unknown account", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={OWNER_ROWS}
        grantableRoles={["ADMIN", "STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    const emailInput =
      container!.querySelector<HTMLInputElement>("#staff-email")!;
    emailInput.value = "ghost@example.com";
    await submitForm(emailInput.closest("form")!);
    const alert = container!.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("sign in first");
  });

  it("renders an empty state when there are no staff rows", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={[]}
        grantableRoles={["ADMIN", "STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    expect(container!.textContent).toContain("No staff to show");
  });
});

describe("StaffManager as ADMIN", () => {
  it("offers only STAFF and TRAINER, and no controls on the ADMIN row", async () => {
    const rows: StaffRow[] = [
      {
        membershipId: "mem-admin",
        displayName: "Andy Admin",
        role: "ADMIN",
        addedLabel: "Added 2 Sep 2026",
        isSelf: false,
        canManage: false,
      },
      {
        membershipId: "mem-staff",
        displayName: "Sam Staff",
        role: "STAFF",
        addedLabel: "Added 3 Oct 2026",
        isSelf: false,
        canManage: true,
      },
    ];
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={rows}
        grantableRoles={["STAFF", "TRAINER"]}
        canManageStaff
      />,
    );
    const select = container!.querySelector<HTMLSelectElement>("#staff-role");
    const options = [...select!.options].map((o) => o.textContent);
    expect(options).toEqual(["Staff", "Trainer"]);
    expect(rowByText("Andy Admin").querySelectorAll("button")).toHaveLength(0);
    expect(
      buttonByText(rowByText("Sam Staff"), "Change role"),
    ).toBeTruthy();
  });

  it("hides the add section entirely for a viewer without manage rights", async () => {
    await render(
      <StaffManager
        organizationName="Powerhouse Gym"
        rows={OWNER_ROWS}
        grantableRoles={[]}
        canManageStaff={false}
      />,
    );
    expect(container!.querySelector("#staff-email")).toBeNull();
    expect(container!.textContent).toContain("Sam Staff");
  });
});
