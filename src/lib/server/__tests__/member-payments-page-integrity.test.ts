import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const PAGE = read("src/app/member/payments/page.tsx");
const FORM = read("src/app/member/payments/claim-form.tsx");
const MEMBER_HOME = read("src/app/member/page.tsx");

/**
 * Member payments page coherence (Payment Claims C2): the page must
 * scope everything through the verified member session, derive the
 * balance through the existing accounting helpers, and present claims
 * as unverified reports — never as paid amounts.
 */
describe("member payments page scoping", () => {
  it("requires the member session context from the session module", () => {
    // Entitlement wrapper (trial/subscription slice): it resolves the
    // same server-side member session context as before, then
    // additionally redirects restricted gyms to the restricted notice.
    expect(PAGE).toMatch(/requireEntitledMemberContext/);
    expect(PAGE).toMatch(/from "@\/lib\/server\/subscriptions"/);
  });

  it("translates the session into a claim scope in exactly one place", () => {
    expect(PAGE).toMatch(/memberClaimScope\(context\)/);
  });

  it("reads only through the scope-taking service functions", () => {
    expect(PAGE).toMatch(/getOwnMembershipSummary\(scope\)/);
    expect(PAGE).toMatch(/listOwnPaymentClaims\(scope\)/);
  });

  it("accepts no client-supplied scoping input at all", () => {
    expect(PAGE).not.toMatch(/searchParams/);
    expect(PAGE).not.toMatch(/params/);
  });

  it("explains that a claim counts only after gym verification", () => {
    expect(PAGE).toMatch(/counts as paid only after the gym verifies/);
    expect(PAGE).toMatch(/Awaiting verification/);
  });

  it("is linked from the member home", () => {
    expect(MEMBER_HOME).toMatch(/href="\/member\/payments"/);
  });
});

describe("claim form contract", () => {
  it("posts only payment details to the claims endpoint", () => {
    expect(FORM).toMatch(/"\/api\/member-payments\/claims"/);
    expect(FORM).toMatch(/JSON\.stringify\(\{ amount, paymentMethod, reference \}\)/);
    expect(FORM).not.toMatch(/organizationId/);
    expect(FORM).not.toMatch(/memberId/);
    expect(FORM).not.toMatch(/userId/);
  });

  it("labels every field for assistive technology", () => {
    expect(FORM).toMatch(/htmlFor="claim-amount"/);
    expect(FORM).toMatch(/htmlFor="claim-method"/);
    expect(FORM).toMatch(/htmlFor="claim-reference"/);
  });

  it("announces outcomes and repeats the verification caveat on success", () => {
    expect(FORM).toMatch(/role="alert"/);
    expect(FORM).toMatch(/role="status"/);
    expect(FORM).toMatch(/counts as paid only\s+after the gym verifies it/);
  });
});
