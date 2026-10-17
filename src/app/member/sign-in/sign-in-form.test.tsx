// @vitest-environment jsdom
/**
 * Behavioural tests for the member sign-in form's join entry point
 * (onboarding Slice 1).
 *
 * The static "Request to join" entry is the property under test: it
 * is part of the initial render — visible before any sign-in or link
 * attempt, and never conditioned on a link outcome — because the UI
 * must never treat a generic linking failure as proof that a person
 * is a new member. Choosing it only switches the phone step's intent;
 * the OTP journey itself is unchanged (the flow's own suite covers
 * the state machine, and the endpoint alone decides eligibility).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { SignInForm } from "./sign-in-form";

let container: HTMLDivElement;
let root: Root;

async function renderForm() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SignInForm gymId="gym-1" />);
  });
}

function findButton(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("SignInForm — join entry point", () => {
  it("shows the Request to join entry in the initial render, before any sign-in attempt", async () => {
    await renderForm();
    expect(container.textContent).toContain("New to this gym?");
    expect(findButton("Request to join")).toBeTruthy();
    // The ordinary sign-in form is the default intent.
    expect(container.textContent).toContain(
      "Enter the phone number registered with this gym.",
    );
    expect(container.querySelector("#joinName")).toBeNull();
  });

  it("choosing it only switches intent copy — the phone step and its form are unchanged", async () => {
    await renderForm();
    await act(async () => {
      findButton("Request to join").click();
    });
    expect(container.textContent).toContain(
      "send your join request to this gym",
    );
    expect(findButton("Sign in instead")).toBeTruthy();
    // Still the phone step: same phone input, no join-details fields.
    expect(container.querySelector("#phoneNumber")).not.toBeNull();
    expect(container.querySelector("#joinName")).toBeNull();

    await act(async () => {
      findButton("Sign in instead").click();
    });
    expect(container.textContent).toContain(
      "Enter the phone number registered with this gym.",
    );
    expect(findButton("Request to join")).toBeTruthy();
  });
});
