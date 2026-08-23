import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonAccent = "cyan" | "green" | "orange" | "purple" | "neutral";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  accent?: ButtonAccent;
  variant?: "solid" | "outline" | "ghost";
  icon?: ReactNode;
  iconTrailing?: ReactNode;
  children: ReactNode;
}

export function Button({
  accent = "cyan",
  variant = "outline",
  icon,
  iconTrailing,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[styles.button, styles[accent], styles[variant], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {icon}
      <span>{children}</span>
      {iconTrailing}
    </button>
  );
}
