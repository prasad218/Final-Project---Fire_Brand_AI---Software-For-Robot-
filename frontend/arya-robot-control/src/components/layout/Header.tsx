import { useEffect, useState } from "react";
import { Settings, Flame } from "lucide-react";
import { StatusIndicator } from "../common/StatusIndicator";
import styles from "./Header.module.css";

interface HeaderProps {
  online: boolean;
  onOpenSettings: () => void;
}

export function Header({ online, onOpenSettings }: HeaderProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.brandIcon}>
          <Flame size={16} />
        </span>
        <div>
          <div className={styles.brandName}>FIRE BRAND AI</div>
          <div className={styles.brandTagline}>Building Intelligent Machines</div>
        </div>
      </div>

      <div className={styles.title}>
        <span className={styles.titleMain}>ARYA</span>
        <span className={styles.titleSub}>Robot Control Center</span>
      </div>

      <div className={styles.right}>
        <StatusIndicator label={online ? "System Online" : "System Offline"} tone={online ? "green" : "red"} />
        <span className={styles.clock}>
          {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <button className={styles.settingsBtn} onClick={onOpenSettings} aria-label="Open settings">
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
