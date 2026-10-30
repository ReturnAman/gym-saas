// @vitest-environment jsdom
/**
 * Renew-membership form: renders the current period's plan/fee as
 * editable defaults, the suggested expiry as an editable date, the
 * pending-claim note, and ONE stable H4 idempotency token per form
 * instance (retries of one intentional renewal resolve to the
 * original renewal server-side).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as never}</a>
  ),
}));

import { RenewalForm } from "./renewal-form";

let container: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

async function render(pendingClaimsCount = 0) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <RenewalForm
        memberId="member-1"
        defaultPlan="SIX_MONTHS"
        defaultFeePaise={600050}
        newPeriodStartLabel="1 Nov 2026"
        suggestedExpiryDate="2027-04-30"
        pendingClaimsCount={pendingClaimsCount}
      />,
    );
  });
}

describe("RenewalForm", () => {
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
      root.render(
        <RenewalForm
          memberId="member-1"
          defaultPlan="SIX_MONTHS"
          defaultFeePaise={600050}
          newPeriodStartLabel="1 Nov 2026"
          suggestedExpiryDate="2027-04-30"
          pendingClaimsCount={0}
        />,
      );
    });
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="idempotencyToken"]',
      )?.value,
    ).toBe(first);
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

  it("defaults plan, fee and expiry from the current period, all editable", async () => {
    await render();
    const plan = container.querySelector<HTMLSelectElement>(
      'select[name="plan"]',
    );
    expect(plan?.value).toBe("SIX_MONTHS");
    const fee = container.querySelector<HTMLInputElement>('input[name="fee"]');
    expect(fee?.value).toBe("6000.50");
    const expiry = container.querySelector<HTMLInputElement>(
      'input[name="expiryDate"]',
    );
    expect(expiry?.value).toBe("2027-04-30");
    expect(expiry?.type).toBe("date");
    expect(container.textContent).toContain("1 Nov 2026");
  });

  it("shows the pending-claim note only when claims are pending", async () => {
    await render(2);
    expect(container.textContent).toContain(
      "2 payment claims are still awaiting verification",
    );
    expect(container.textContent).toContain("stay with the current period");
  });

  it("omits the pending-claim note when nothing is pending", async () => {
    await render(0);
    expect(container.textContent).not.toContain("awaiting verification");
  });
});
