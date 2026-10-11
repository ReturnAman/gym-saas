"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Check-in button for the member QR landing page.
 *
 * Posts only the QR gym claim to the check-in endpoint; identity, gym
 * scope, and the member record are resolved server-side from the
 * session cookie. On a definitive result the page is refreshed so the
 * server-rendered state (e.g. "You're checked in" with the timestamp)
 * replaces this button — the message shown meanwhile is a fallback.
 */
export function CheckInButton({ gymId }: { gymId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCheckIn() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/member-attendance/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gym: gymId }),
      });
      const body = (await response.json().catch(() => null)) as {
        result?: unknown;
        error?: { message?: unknown };
      } | null;

      if (body?.result === "checked_in") {
        setMessage("You're checked in.");
        router.refresh();
        return;
      }
      if (body?.result === "already_checked_in") {
        setMessage("You're already checked in.");
        router.refresh();
        return;
      }
      const serverMessage =
        typeof body?.error?.message === "string" ? body.error.message : null;
      setMessage(serverMessage ?? "Could not check in. Please try again.");
    } catch {
      setMessage("Could not check in. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleCheckIn} disabled={pending}>
        {pending ? "Checking in…" : "Check in"}
      </button>
      {message && (
        <p role="alert">{message}</p>
      )}
    </div>
  );
}
