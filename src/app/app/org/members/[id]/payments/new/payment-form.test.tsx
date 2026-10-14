// @vitest-environment jsdom
/**
 * Record Payment form (H4): the form mints ONE idempotency token when
 * it mounts and keeps submitting that same token for the life of the
 * form instance, so retries of one intentional payment resolve to the
 * original payment server-side instead of duplicating it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as never}</a>
  ),
}));

import { RecordPaymentForm } from "./payment-form";

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
    root.render(<RecordPaymentForm memberId="member-1" />);
  });
}

describe("RecordPaymentForm", () => {
  it("renders a hidden idempotency token and keeps it stable across re-renders", async () => {
    await render();
    const token = container.querySelector<HTMLInputElement>(
      'input[name="idempotencyToken"]',
    );
    expect(token).not.toBeNull();
    expect(token?.type).toBe("hidden");
    expect(token?.value).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/);
    const first = token?.value;
    await act(async () => {
      root.render(<RecordPaymentForm memberId="member-1" />);
    });
    const again = container.querySelector<HTMLInputElement>(
      'input[name="idempotencyToken"]',
    );
    expect(again?.value).toBe(first);
  });

  it("a fresh form instance mints a different token (a new operation)", async () => {
    await render();
    const first = container.querySelector<HTMLInputElement>(
      'input[name="idempotencyToken"]',
    )?.value;
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await render();
    const second = container.querySelector<HTMLInputElement>(
      'input[name="idempotencyToken"]',
    )?.value;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});
