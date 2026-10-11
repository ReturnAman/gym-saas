import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const PAGE = read("src/app/member/scan/page.tsx");
const SCANNER = read("src/app/member/scan/scanner.tsx");

/**
 * In-app QR scanner coherence (Attendance Slice 2 revision): the scan
 * page is a public discovery step that must never become an
 * authentication or navigation shortcut. Scanned content is untrusted:
 * it may reach navigation only as a validated gym identifier on the
 * application's own check-in route — never as a raw URL.
 */
describe("member scan page", () => {
  it("is public: it does not resolve a member session", () => {
    expect(PAGE).not.toMatch(/requireMemberContext/);
    expect(PAGE).not.toMatch(/getMemberContext/);
    expect(PAGE).not.toMatch(/member-session/);
  });

  it("keeps the manual fallback to the check-in landing", () => {
    expect(PAGE).toMatch(/Continue without scanning/);
    expect(PAGE).toMatch(/href="\/member\/check-in"/);
  });
});

describe("member QR scanner", () => {
  it("validates scanned content through the pure validator", () => {
    expect(SCANNER).toMatch(/from "@\/lib\/qr-check-in"/);
    expect(SCANNER).toMatch(/parseScannedCheckInUrl\(code\.data/);
  });

  it("decodes locally with jsQR and the camera — no BarcodeDetector dependency", () => {
    expect(SCANNER).toMatch(/from "jsqr"/);
    expect(SCANNER).toMatch(/getUserMedia/);
    expect(SCANNER).not.toMatch(/BarcodeDetector/);
  });

  it("never navigates to the scanned string itself", () => {
    expect(SCANNER).not.toMatch(/location\.href/);
    expect(SCANNER).not.toMatch(/location\.assign/);
    expect(SCANNER).not.toMatch(/push\(code\.data/);
    expect(SCANNER).not.toMatch(/href=\{code\.data/);
    // The only navigation target is the app's own check-in route built
    // from the validated gym identifier.
    expect(SCANNER).toMatch(/router\.push\(`\/member\/check-in\?gym=/);
  });

  it("requests the camera only from the start action, not on load", () => {
    expect(SCANNER).toMatch(/onClick=\{start\}/);
    expect(SCANNER).toMatch(/Start scanning/);
  });
});
