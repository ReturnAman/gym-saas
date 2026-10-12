"use client";

import Link from "next/link";

import styles from "./payment-claims.module.css";

export default function PaymentClaimsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <section className={styles.stateBox} aria-label="Payment claims failed to load">
        <h2>Could not load payment claims</h2>
        <p>
          Something went wrong while loading the payments waiting for
          verification. Please try again.
        </p>
        <div className={styles.stateActions}>
          <button type="button" onClick={reset} className={styles.button}>
            Try again
          </button>
          <Link href="/app/org" className={styles.secondaryButton}>
            Back to gym
          </Link>
        </div>
      </section>
    </main>
  );
}
