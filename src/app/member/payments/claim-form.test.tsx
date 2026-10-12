// @vitest-environment jsdom
/**
 * Behavioral tests for the member claim form (Payment Claims C2).
 *
 * The network is stubbed; the service and route have their own suites.
 * These tests pin what the member sees and sends: labelled fields, a
 * details-only payload (no identity fields — the session scopes the
 * request), the success state repeating that a claim is not yet paid,
 * and server errors surfaced verbatim.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { ClaimForm } from "./claim-form";

let container: HTMLDivElement;
let root: Root;
let fetchStub: ReturnType<typeof vi.fn>;

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderForm() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ClaimForm />);
  });
}

async function submitForm() {
  const form = container.querySelector("form");
  if (!form) throw new Error("form not rendered");
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  // Let the fetch promise and state updates settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchStub = vi.fn();
  vi.stubGlobal("fetch", fetchStub);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("ClaimForm", () => {
  it("renders labelled amount, method, and reference fields", async () => {
    await renderForm();
    expect(container.querySelector('label[for="claim-amount"]')).not.toBeNull();
    expect(container.querySelector("#claim-amount")).not.toBeNull();
    expect(container.querySelector('label[for="claim-method"]')).not.toBeNull();
    expect(container.querySelector("#claim-method")).not.toBeNull();
    expect(container.querySelector('label[for="claim-reference"]')).not.toBeNull();
    expect(container.querySelector("#claim-reference")).not.toBeNull();
  });

  it("posts only the payment details and shows the verification caveat on success", async () => {
    fetchStub.mockResolvedValue({
      ok: true,
      json: async () => ({ result: "claim_submitted", claimId: "claim-1" }),
    });
    await renderForm();
    const amount = container.querySelector<HTMLInputElement>("#claim-amount");
    if (!amount) throw new Error("amount input missing");
    await act(async () => {
      setInputValue(amount, "500");
    });
    await submitForm();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/member-payments/claims");
    expect(JSON.parse(String(init.body))).toEqual({
      amount: "500",
      paymentMethod: "UPI",
      reference: "",
    });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("counts as paid only");
    expect(status?.textContent).toContain("after the gym verifies it");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the server's error message on a rejected submission", async () => {
    fetchStub.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: {
          code: "DUPLICATE_CLAIM",
          message:
            "You've already told us about this payment. It's waiting for the gym to verify it.",
        },
      }),
    });
    await renderForm();
    const amount = container.querySelector<HTMLInputElement>("#claim-amount");
    if (!amount) throw new Error("amount input missing");
    await act(async () => {
      setInputValue(amount, "500");
    });
    await submitForm();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("already told us");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows a generic retry message when the network fails", async () => {
    fetchStub.mockRejectedValue(new Error("offline"));
    await renderForm();
    await submitForm();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("try again");
  });
});
