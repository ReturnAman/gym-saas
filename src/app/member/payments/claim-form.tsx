"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/members";

/**
 * "Tell the gym you paid" form for /member/payments.
 *
 * Posts only the payment details; identity and gym scope are resolved
 * server-side from the member session cookie. Client-side checks are
 * for usability only — the server validates authoritatively. On
 * success the page is refreshed so the server-rendered claim list
 * (the ground truth) shows the new claim as awaiting verification.
 */
export function ClaimForm() {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("UPI");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSubmitted(false);
    try {
      const response = await fetch("/api/member-payments/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, paymentMethod, reference }),
      });
      const body = (await response.json().catch(() => null)) as {
        result?: unknown;
        error?: { message?: unknown };
      } | null;

      if (response.ok && body?.result === "claim_submitted") {
        setSubmitted(true);
        setAmount("");
        setReference("");
        router.refresh();
        return;
      }
      const serverMessage =
        typeof body?.error?.message === "string" ? body.error.message : null;
      setError(
        serverMessage ??
          "We couldn't record that payment. Please see the front desk.",
      );
    } catch {
      setError("We couldn't record that payment. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p>
        <label htmlFor="claim-amount">Amount paid (₹)</label>
        <br />
        <input
          id="claim-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </p>
      <p>
        <label htmlFor="claim-method">How you paid</label>
        <br />
        <select
          id="claim-method"
          name="paymentMethod"
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value)}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {PAYMENT_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor="claim-reference">
          Reference (optional) — for example a UPI transaction ID
        </label>
        <br />
        <input
          id="claim-reference"
          name="reference"
          type="text"
          autoComplete="off"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </p>
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Tell the gym I paid"}
        </button>
      </p>
      {error && <p role="alert">{error}</p>}
      {submitted && (
        <p role="status">
          Thanks — the gym has your payment claim. It counts as paid only
          after the gym verifies it.
        </p>
      )}
    </form>
  );
}
