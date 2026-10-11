import styles from "./staff.module.css";

export default function StaffLoading() {
  return (
    <main>
      <section className={styles.stateBox} aria-label="Loading staff">
        <h2>Loading staff…</h2>
        <p>Fetching the staff list for your gym.</p>
      </section>
    </main>
  );
}
