import styles from "./payment-claims.module.css";

export default function PaymentClaimsLoading() {
  return (
    <main>
      <section className={styles.stateBox} aria-label="Loading payment claims">
        <h2>Loading payment claims…</h2>
        <p>Fetching the payments waiting for verification at your gym.</p>
      </section>
    </main>
  );
}
