/**
 * Scanned gym QR validation (member self-check-in, in-app scanner).
 *
 * This module is framework-free on purpose: the acceptance rules for a
 * scanned code are security-relevant (a QR code is untrusted input
 * found in the physical world) and must be unit-testable without a
 * camera or a DOM.
 *
 * The gym's printed poster encodes exactly one shape of URL — the
 * canonical member check-in URL built by buildMemberCheckInUrl:
 *
 *   {APP_URL}/member/check-in?gym={organizationId}
 *
 * A scan is accepted only when the decoded text parses as an http(s)
 * URL on EXACTLY the expected application origin, with EXACTLY the
 * check-in path, and a non-empty `gym` parameter. Only the extracted
 * gym identifier is returned. The scanned text itself is never
 * returned, never stored, and never used as a navigation target — the
 * caller navigates to the application's own check-in route with the
 * validated identifier — so a hostile or foreign code cannot steer the
 * member anywhere else.
 */
export function parseScannedCheckInUrl(
  text: string,
  expectedOrigin: string,
): { gym: string } | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.origin !== expectedOrigin) {
    return null;
  }
  if (url.pathname !== "/member/check-in") {
    return null;
  }

  const gym = url.searchParams.get("gym");
  if (!gym) {
    return null;
  }
  return { gym };
}
