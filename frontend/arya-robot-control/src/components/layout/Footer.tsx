import styles from "./Footer.module.css";

export function Footer() {
  return (
    <div className={styles.footer}>
      <span>ARYA v1.0.0</span>
      <span className={styles.dot}>&middot;</span>
      <span>Fire Brand AI</span>
    </div>
  );
}
