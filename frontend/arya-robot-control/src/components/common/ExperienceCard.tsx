import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import styles from "./ExperienceCard.module.css";

interface ExperienceCardProps {
  eyebrow: string;
  icon: ReactNode;
  title: ReactNode;
  description: string;
  ctaLabel: string;
  accent: "cyan" | "green" | "purple";
  onSelect: () => void;
  visual?: ReactNode;
}

export function ExperienceCard({
  eyebrow,
  icon,
  title,
  description,
  ctaLabel,
  accent,
  onSelect,
  visual,
}: ExperienceCardProps) {
  return (
    <article className={[styles.card, styles[accent]].join(" ")}>
      <span className={styles.badge}>{icon}{eyebrow}</span>
      {visual && <div className={styles.visual}>{visual}</div>}
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      <button className={styles.cta} onClick={onSelect}>
        <span>{ctaLabel}</span>
        <ArrowRight size={16} />
      </button>
    </article>
  );
}
