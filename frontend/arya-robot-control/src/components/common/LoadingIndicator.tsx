import styles from "./LoadingIndicator.module.css";

interface LoadingIndicatorProps {
  label?: string;
}

export function LoadingIndicator({ label }: LoadingIndicatorProps) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <span className={styles.ring} />
      {label && <span className={styles.label}>{label}</span>}
    </div>
  );
}
