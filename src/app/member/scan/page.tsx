import Link from "next/link";

import { Scanner } from "./scanner";

/**
 * In-app gym QR scan (public).
 *
 * Scanning is a discovery step, not an authentication step: this page
 * deliberately does NOT require a member session. A signed-out member
 * can scan first and is then carried into the existing check-in
 * landing with the gym preserved — the landing resolves the session
 * state and handles sign-in, gym mismatch, and the explicit check-in
 * confirmation exactly as when the code is opened any other way
 * (ADR 022). The scanner itself validates the code against this
 * application's origin and check-in route before navigating anywhere;
 * see scanner.tsx.
 */
export default function MemberScanPage() {
  return (
    <main>
      <h1>Scan gym QR</h1>
      <p>
        Scan the QR code posted at your gym to open its check-in page.
        The camera is used only while scanning, and only after you tap
        Start scanning below.
      </p>

      <Scanner />

      <h2>Can&apos;t scan?</h2>
      <p>
        <Link href="/member/check-in">Continue without scanning</Link>
      </p>
      <p>
        If you can&apos;t scan, gym staff can check you in at the front
        desk.
      </p>
    </main>
  );
}
