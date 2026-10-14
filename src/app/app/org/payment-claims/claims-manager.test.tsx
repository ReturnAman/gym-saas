// @vitest-environment jsdom
/**
 * Behavioral tests for the claim review queue (C3-S2).
 *
 * The server actions are stubbed (their behavior is covered in
 * actions.test.ts; authorization and accounting live in the service
 * suites). These tests pin what staff SEE and can do: the review
 * fields, the amount defaulting to the claimed amount, the two-step
 * reject, disabled buttons while an action is pending, safe outcome
 * messages, and that no internal IDs appear as visible content.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfirmAction, mockRejectAction } = vi.hoisted(() => ({
  mockConfirmAction: vi.fn(),
  mockRejectAction: vi.fn(),
}));

vi.mock("./actions", () => ({
  confirmClaimAction: mockConfirmAction,
  rejectClaimAction: mockRejectAction,
}));

import { ClaimsManager, type ClaimReviewRow } from "./claims-manager";
import type { ClaimDecisionState } from "./payment-claims-action-state";

const OK_CONFIRM: ClaimDecisionState = {
  ok: true,
  message: "Payment confirmed and recorded.",
  errors: {},
};
const OK_REJECT: ClaimDecisionState = {
  ok: true,
  message: "Claim rejected.",
  errors: {},
};

const ROW: ClaimReviewRow = {
  id: "claim-secret-id",
  memberId: "member-secret-id",
  memberName: "Asha Rao",
  memberPhoneNumber: "9000000021",
  membershipPlan: "MONTHLY",
  membershipFeePaise: 100_000,
  membershipExpiryDate: "2026-02-01T00:00:00.000Z",
  claimedAmountPaise: 60_000,
  paymentMethod: "UPI",
  reference: "UTR123",
  submittedAt: "2026-10-12T04:30:00.000Z",
  paidPaise: 40_000,
  outstandingPaise: 60_000,
};

let container: HTMLDivElement;
let root: Root;

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ClaimsManager claims={[ROW]} />);
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

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfirmAction.mockResolvedValue(OK_CONFIRM);
  mockRejectAction.mockResolvedValue(OK_REJECT);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("ClaimsManager", () => {
  it("shows the review fields with formatted money and the gym-side context", async () => {
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("Asha Rao");
    expect(text).toContain("9000000021");
    expect(text).toContain("Monthly");
    expect(text).toContain("UPI");
    expect(text).toContain("UTR123");
    expect(text).toContain("₹600"); // claimed amount
    expect(text).toContain("₹1,000"); // membership fee
    expect(text).toContain("₹400"); // paid so far
    expect(text).toContain("12 Oct 2026"); // submitted, Asia/Kolkata
  });

  it("never renders internal IDs as visible content", async () => {
    await render();
    const text = container.textContent ?? "";
    expect(text).not.toContain("claim-secret-id");
    expect(text).not.toContain("member-secret-id");
  });

  it("the confirm form carries a stable idempotency token (H4)", async () => {
    await render();
    const tokens = container.querySelectorAll<HTMLInputElement>(
      'input[name="idempotencyToken"]',
    );
    // Exactly one token: on the payment-creating confirm form only —
    // the reject form creates no payment and carries none.
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.type).toBe("hidden");
    expect(tokens[0]?.value).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/);
  });

  it("labels the amount field and defaults it to the claimed amount", async () => {
    await render();
    const label = container.querySelector('label[for^="confirm-amount-"]');
    expect(label?.textContent).toBe("Amount actually received (₹)");
    const input = container.querySelector<HTMLInputElement>(
      'input[name="amount"]',
    );
    expect(input?.value).toBe("600");
    expect(container.textContent).toContain(
      "This is the amount recorded as paid when you confirm.",
    );
  });

  it("confirms through the action and shows the outcome", async () => {
    await render();
    const form = buttonByText("Confirm payment").closest("form");
    if (!form) throw new Error("confirm form missing");
    await submitForm(form);
    expect(mockConfirmAction).toHaveBeenCalledTimes(1);
    const formData = mockConfirmAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("claimId")).toBe("claim-secret-id");
    expect(formData.get("amount")).toBe("600");
    expect(container.textContent).toContain(
      "Payment confirmed and recorded.",
    );
  });

  it("shows an already-decided conflict as a safe alert", async () => {
    mockConfirmAction.mockResolvedValue({
      ok: false,
      message: "This claim has already been decided.",
      errors: {},
    });
    await render();
    const form = buttonByText("Confirm payment").closest("form");
    if (!form) throw new Error("confirm form missing");
    await submitForm(form);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("already been decided");
  });

  it("requires the second step to reject, and Cancel disarms it", async () => {
    await render();
    expect(container.textContent).not.toContain("Confirm rejection");
    await click(buttonByText("Reject claim"));
    expect(container.textContent).toContain("No payment will be recorded.");
    expect(mockRejectAction).not.toHaveBeenCalled();

    await click(buttonByText("Cancel"));
    expect(container.textContent).not.toContain("Confirm rejection");

    await click(buttonByText("Reject claim"));
    const form = buttonByText("Confirm rejection").closest("form");
    if (!form) throw new Error("reject form missing");
    await submitForm(form);
    expect(mockRejectAction).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Claim rejected.");
  });

  it("disables decision buttons while a confirmation is pending", async () => {
    let resolveAction: ((state: ClaimDecisionState) => void) | undefined;
    mockConfirmAction.mockImplementation(
      () =>
        new Promise<ClaimDecisionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    await render();
    const form = buttonByText("Confirm payment").closest("form");
    if (!form) throw new Error("confirm form missing");
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(buttonByText("Confirming…").disabled).toBe(true);
    expect(buttonByText("Reject claim").disabled).toBe(true);
    resolveAction?.(OK_CONFIRM);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
