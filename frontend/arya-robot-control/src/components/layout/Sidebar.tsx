import { Home, Video, Box, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { RobotState } from "../../types/robot";
import { Footer } from "./Footer";
import styles from "./Sidebar.module.css";

export type RouteId = "home" | "live" | "simulation" | "talk";

interface NavItem {
  id: RouteId;
  label: string;
  icon: ReactNode;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: <Home size={18} /> },
  { id: "live", label: "VCET Live Demo", icon: <Video size={18} /> },
  { id: "simulation", label: "3D Simulation", icon: <Box size={18} /> },
  { id: "talk", label: "Talk with ARYA", icon: <MessageCircle size={18} /> },
];

interface SidebarProps {
  active: RouteId;
  onNavigate: (route: RouteId) => void;
  robot: RobotState;
}

export function Sidebar({ active, onNavigate, robot }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={[styles.navItem, active === item.id ? styles.active : ""].join(" ")}
            onClick={() => onNavigate(item.id)}
            aria-current={active === item.id ? "page" : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className={styles.vitals}>
        <div className={styles.vitalsRow}>
          <span>Battery</span>
          <span className={styles.vitalsValue}>{robot.battery}%</span>
        </div>
        <div className={styles.vitalsRow}>
          <span>Mode</span>
          <span className={styles.vitalsValue}>{robot.mode}</span>
        </div>
      </div>

      <Footer />
    </aside>
  );
}
