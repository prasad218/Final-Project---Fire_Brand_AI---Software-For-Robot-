import { NAV_ITEMS, type RouteId } from "./Sidebar";
import styles from "./MobileTabBar.module.css";

interface MobileTabBarProps {
  active: RouteId;
  onNavigate: (route: RouteId) => void;
}

/** Bottom tab bar for narrow viewports, where the sidebar hides itself
 * (see Sidebar.module.css) — without this there was no way to navigate
 * the app at all on a phone. Reuses the same NAV_ITEMS as the sidebar so
 * the two never drift out of sync. */
export function MobileTabBar({ active, onNavigate }: MobileTabBarProps) {
  return (
    <nav className={styles.bar} aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={[styles.tab, active === item.id ? styles.active : ""].join(" ")}
          onClick={() => onNavigate(item.id)}
          aria-current={active === item.id ? "page" : undefined}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
