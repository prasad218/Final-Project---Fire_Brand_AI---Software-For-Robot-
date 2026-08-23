import styles from "./StatusIndicator.module.css";

export type StatusTone = "green" | "cyan" | "orange" | "purple" | "red" | "muted";

interface StatusIndicatorProps {
  label: string;
  tone?: StatusTone;
  pulse?: boolean;
}

export function StatusIndicator({ label, tone = "green", pulse = true }: StatusIndicatorProps) {
  return (
    <span className={styles.wrap}>
      <span className={[styles.dot, styles[tone], pulse ? styles.pulse : ""].join(" ")} />
      <span className={[styles.label, styles[`text-${tone}`]].join(" ")}>{label}</span>
    </span>
  );
}
