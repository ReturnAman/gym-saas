// @vitest-environment jsdom
/**
 * Behavioral tests for the join-request decision queue (Slice 2).
 *
 * The server actions are stubbed (their behavior is covered in
 * actions.test.ts; authorization and the decision transaction live
 * in the service suites). These tests pin what staff SEE and can do:
 * the proposal summary, the confirm-terms form prefilled from the
 * proposal, the live derived-expiry preview, the two-step reject,
 * disabled buttons while an action is pending, safe outcome
 * messages, and that no internal IDs appear as visible content.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockApproveAction, mockRejectAction } = vi.hoisted(() => ({
  mockApproveAction: vi.fn(),
  mockRejectAction: vi.fn(),
}));

vi.mock("./actions", () => ({
  approveJoinRequestAction: mockApproveAction,
  rejectJoinRequestAction: mockRejectAction,
}));

import {
  JoinRequestsManager,
  type JoinRequestRow,
} from "./join-requests-manager";
import type { JoinRequestDecisionState } from "./join-requests-action-state";

const OK_APPROVE: JoinRequestDecisionState = {
  ok: true,
  message:
    "Approved — the member and their membership have been created. No payment has been recorded; the fee is outstanding until it is paid.",
  errors: {},
};
const OK_REJECT: JoinRequestDecisionState = {
  ok: true,
  message: "Request rejected.",
  errors: {},
};

const ROW: JoinRequestRow = {
  id: "request-secret-id",
  name: "Asha Rao",
  phoneNumber: "9000000021",
  requestedPlan: "MONTHLY",
  proposedFeePaise: 150_000,
  proposedStartDate: "2026-11-01T00:00:00.000Z",
  submittedAt: "2026-10-17T04:30:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<JoinRequestsManager requests={[ROW]} />);
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function submitForm(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function changeValue(element: Element, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApproveAction.mockResolvedValue(OK_APPROVE);
  mockRejectAction.mockResolvedValue(OK_REJECT);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("JoinRequestsManager", () => {
  it("shows who asked, for which gym terms, and when", async () => {
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("Asha Rao");
    expect(text).toContain("9000000021");
    expect(text).toContain("Monthly");
    expect(text).toContain("₹1,500"); // proposed fee
    expect(text).toContain("01/11/2026"); // proposed start
    expect(text).toContain("17 Oct 2026"); // submitted, Asia/Kolkata
  });

  it("never renders the request ID as visible content", async () => {
    await render();
    expect(container.textContent ?? "").not.toContain("request-secret-id");
  });

  it("prefills the confirm-terms form from the proposal", async () => {
    await render();
    const plan = container.querySelector<HTMLSelectElement>(
      'select[name="plan"]',
    );
    expect(plan?.value).toBe("MONTHLY");
    const fee = container.querySelector<HTMLInputElement>(
      'input[name="fee"]',
    );
    expect(fee?.value).toBe("1500");
    const start = container.querySelector<HTMLInputElement>(
      'input[name="startDate"]',
    );
    expect(start?.value).toBe("2026-11-01");
  });

  it("previews the derived expiry and updates it as plan and start change", async () => {
    await render();
    // MONTHLY from 2026-11-01 → runs until 01/12/2026.
    expect(container.textContent).toContain("until 01/12/2026");

    const plan = container.querySelector<HTMLSelectElement>(
      'select[name="plan"]',
    );
    if (!plan) throw new Error("plan select missing");
    await changeValue(plan, "TWELVE_MONTHS");
    expect(container.textContent).toContain("until 01/11/2027");

    const start = container.querySelector<HTMLInputElement>(
      'input[name="startDate"]',
    );
    if (!start) throw new Error("start input missing");
    await changeValue(start, "2027-01-31");
    // TWELVE_MONTHS from 2027-01-31 → 31/01/2028.
    expect(container.textContent).toContain("until 31/01/2028");
  });

  it("approves through the action with the confirmed terms and shows the outcome", async () => {
    await render();
    const fee = container.querySelector<HTMLInputElement>(
      'input[name="fee"]',
    );
    if (!fee) throw new Error("fee input missing");
    await changeValue(fee, "1800");

    const form = buttonByText("Approve and create membership").closest("form");
    if (!form) throw new Error("approve form missing");
    await submitForm(form);
    expect(mockApproveAction).toHaveBeenCalledTimes(1);
    const formData = mockApproveAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("requestId")).toBe("request-secret-id");
    expect(formData.get("plan")).toBe("MONTHLY");
    expect(formData.get("fee")).toBe("1800");
    expect(formData.get("startDate")).toBe("2026-11-01");
    expect(container.textContent).toContain("No payment has been recorded");
  });

  it("shows field errors from the action against the form", async () => {
    mockApproveAction.mockResolvedValue({
      ok: false,
      message: null,
      errors: {
        fee: "Fee must be a valid amount, for example 6000 or 6000.50.",
      },
    });
    await render();
    const form = buttonByText("Approve and create membership").closest("form");
    if (!form) throw new Error("approve form missing");
    await submitForm(form);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("valid amount");
  });

  it("shows a decision conflict as a safe alert", async () => {
    mockApproveAction.mockResolvedValue({
      ok: false,
      message:
        "This member already has a membership, so approving would create a second one. The request is still pending — check the member's record first.",
      errors: {},
    });
    await render();
    const form = buttonByText("Approve and create membership").closest("form");
    if (!form) throw new Error("approve form missing");
    await submitForm(form);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("already has a membership");
  });

  it("requires the second step to reject, and Cancel disarms it", async () => {
    await render();
    expect(container.textContent).not.toContain("Confirm rejection");
    await click(buttonByText("Reject request"));
    expect(container.textContent).toContain("will not become a member");
    expect(mockRejectAction).not.toHaveBeenCalled();

    await click(buttonByText("Cancel"));
    expect(container.textContent).not.toContain("Confirm rejection");

    await click(buttonByText("Reject request"));
    const form = buttonByText("Confirm rejection").closest("form");
    if (!form) throw new Error("reject form missing");
    await submitForm(form);
    expect(mockRejectAction).toHaveBeenCalledTimes(1);
    const formData = mockRejectAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("requestId")).toBe("request-secret-id");
    expect(container.textContent).toContain("Request rejected.");
  });

  it("disables decision buttons while an approval is pending", async () => {
    let resolveAction:
      | ((state: JoinRequestDecisionState) => void)
      | undefined;
    mockApproveAction.mockImplementation(
      () =>
        new Promise<JoinRequestDecisionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    await render();
    const form = buttonByText("Approve and create membership").closest("form");
    if (!form) throw new Error("approve form missing");
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(buttonByText("Approving…").disabled).toBe(true);
    expect(buttonByText("Reject request").disabled).toBe(true);
    resolveAction?.(OK_APPROVE);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
