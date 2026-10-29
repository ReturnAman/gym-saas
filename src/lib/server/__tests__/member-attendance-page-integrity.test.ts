import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const PAGE = read("src/app/member/attendance/page.tsx");

/**
 * Member attendance history page coherence (Attendance Slice 2, S4):
 * the page must scope everything through the verified member session
 * context and must not accept any request input that could steer the
 * queries to another tenant or another person's records.
 */
describe("member attendance page scoping", () => {
  it("requires the member session context from the session module", () => {
    // Entitlement wrapper (trial/subscription slice): it resolves the
    // same server-side member session context as before, then
    // additionally redirects restricted gyms to the restricted notice.
    expect(PAGE).toMatch(/requireEntitledMemberContext/);
    expect(PAGE).toMatch(/from "@\/lib\/server\/subscriptions"/);
  });

  it("queries attendance only through the context-scoped service calls", () => {
    expect(PAGE).toMatch(/getOwnAttendancePage\(context, 30\)/);
  });

  it("accepts no client-supplied scoping input at all", () => {
    expect(PAGE).not.toMatch(/searchParams/);
    expect(PAGE).not.toMatch(/organizationId/);
    expect(PAGE).not.toMatch(/memberId/);
  });

  it("renders displayed times through the Kolkata formatters", () => {
    expect(PAGE).toMatch(/formatKolkata/);
    expect(PAGE).toMatch(/from "@\/lib\/attendance"/);
  });
});
