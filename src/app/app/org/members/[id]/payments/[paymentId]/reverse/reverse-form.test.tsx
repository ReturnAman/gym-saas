// @vitest-environment jsdom
/**
 * Reverse Payment form: mirrors the Record Payment form's H4
 * contract — ONE idempotency token per form instance, stable across
 * re-renders — and pins the reversal-specific fields: the amount is
 * prefilled with what can still be reversed, all six reason categories
 * are offered, and the explanation is bounded at 280 characters.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as never}</a>
  ),
}));

import { ReversePaymentForm } from "./reverse-form";

let container: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ReversePaymentForm
        memberId="member-1"
        paymentId="payment-1"
        remainingPaise={400_050}
      />,
    );
  });
}

function tokenValue() {
  return container.querySelector<HTMLInputElement>(
    'input[name="idempotencyToken"]',
  )?.value;
}

describe("ReversePaymentForm", () => {
  it("renders hidden member/payment ids and one stable idempotency token", async () => {
    await render();
    expect(
      container.querySelector<HTMLInputElement>('input[name="memberId"]')
        ?.value,
    ).toBe("member-1");
    expect(
      container.querySelector<HTMLInputElement>('input[name="paymentId"]')
        ?.value,
    ).toBe("payment-1");
    const token = tokenValue();
    expect(token).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/);
    await act(async () => {
      root.render(
        <ReversePaymentForm
          memberId="member-1"
          paymentId="payment-1"
          remainingPaise={400_050}
        />,
      );
    });
    expect(tokenValue()).toBe(token);
  });

  it("a fresh form instance mints a different token (a new operation)", async () => {
    await render();
    const first = tokenValue();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await render();
    expect(tokenValue()).not.toBe(first);
  });

  it("prefills the amount with the still-reversible amount and offers all six reasons", async () => {
    await render();
    const amount = container.querySelector<HTMLInputElement>(
      'input[name="amount"]',
    );
    expect(amount?.value).toBe("4000.50");
    const options = [
      ...container.querySelectorAll<HTMLOptionElement>('select[name="reason"] option'),
    ].map((option) => option.value);
    expect(options).toEqual([
      "",
      "DUPLICATE_ENTRY",
      "WRONG_MEMBER",
      "WRONG_AMOUNT",
      "PAYMENT_FAILED",
      "REFUNDED_TO_MEMBER",
      "OTHER",
    ]);
  });

  it("bounds the explanation at 280 characters and states the ledger-only nature", async () => {
    await render();
    const explanation = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="explanation"]',
    );
    expect(explanation?.maxLength).toBe(280);
    expect(container.textContent).toContain(
      "does not send money back through a bank or payment gateway",
    );
  });
});
