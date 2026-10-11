import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const PAGE = read("src/app/app/org/attendance/qr/page.tsx");

/**
 * Gym QR poster page coherence (Attendance Slice 2, S5):
 * the organization must come only from the signed-in user's
 * server-side context, the view permission must gate the page, the QR
 * target must be built from the validated APP_URL via the pure helper,
 * and the code must be generated locally — never by an external QR
 * service. A failed URL resolution must render the configuration state
 * with no QR at all.
 */
describe("gym QR page", () => {
  it("resolves the organization from the server-side context only", () => {
    expect(PAGE).toMatch(/requireOrganizationContext/);
    expect(PAGE).toMatch(/from "@\/lib\/server\/authorization"/);
    expect(PAGE).not.toMatch(/searchParams/);
    expect(PAGE).not.toMatch(/params/);
  });

  it("gates the page on the attendance view permission", () => {
    expect(PAGE).toMatch(/canViewAttendance\(membership\.role\)/);
    expect(PAGE).toMatch(/redirect\("\/app\/org\/attendance"\)/);
  });

  it("builds the check-in URL from the validated env via the pure helper", () => {
    expect(PAGE).toMatch(/buildMemberCheckInUrl/);
    expect(PAGE).toMatch(/from "@\/lib\/attendance"/);
    expect(PAGE).toMatch(/env\.appUrl/);
    expect(PAGE).toMatch(/from "@\/lib\/server\/env"/);
    expect(PAGE).toMatch(/buildMemberCheckInUrl\(appUrl, organizationId\)/);
    expect(PAGE).toMatch(/resolveCheckInUrl\(organization\.id\)/);
  });

  it("generates the QR locally with the qrcode package — no external service", () => {
    expect(PAGE).toMatch(/from "qrcode"/);
    expect(PAGE).toMatch(/QRCode\.toString/);
    for (const host of [
      "api.qrserver.com",
      "chart.googleapis.com",
      "qrcode.tec-it",
      "api.qr-code-generator.com",
      "quickchart.io",
    ]) {
      expect(PAGE).not.toContain(host);
    }
    expect(PAGE).not.toMatch(/fetch\(/);
  });

  it("validates the app URL before any QR is generated", () => {
    expect(PAGE).toMatch(/isValidHttpUrl/);
    expect(PAGE).toMatch(/url\.protocol === "http:"/);
    expect(PAGE).toMatch(/url\.protocol === "https:"/);
  });

  it("renders a configuration state (with no QR) when the URL cannot be trusted", () => {
    expect(PAGE).toMatch(/not configured/);
    expect(PAGE).toMatch(/set a valid APP_URL/);
    // The fallback render contains no QR markup path: QRCode generation
    // is guarded by the resolved URL.
    expect(PAGE).toMatch(/if \(checkInUrl\)/);
  });

  it("documents the APP_URL reprint caveat for staff", () => {
    expect(PAGE).toMatch(/reprint this\s+poster/);
  });
});
