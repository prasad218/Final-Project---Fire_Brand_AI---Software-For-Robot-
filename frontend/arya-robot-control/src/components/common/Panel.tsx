import type { ReactNode } from "react";
import styles from "./Panel.module.css";

interface PanelProps {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  accent?: "cyan" | "green" | "orange" | "purple" | "neutral";
}

export function Panel({ title, icon, action, children, className, accent = "neutral" }: PanelProps) {
  return (
    <section className={[styles.panel, styles[accent], className].filter(Boolean).join(" ")}>
      {title && (
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            {icon}
            <h3 className={styles.title}>{title}</h3>
          </div>
          {action}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
