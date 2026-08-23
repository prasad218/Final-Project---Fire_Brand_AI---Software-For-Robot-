import { useEffect, useState } from "react";
import { RobotStateProvider, useRobotState } from "./hooks/useRobotState";
import { Header } from "./components/layout/Header";
import { Sidebar, type RouteId } from "./components/layout/Sidebar";
import { MobileTabBar } from "./components/layout/MobileTabBar";
import { SettingsModal } from "./components/common/SettingsModal";
import { Boot } from "./pages/Boot";
import { Home } from "./pages/Home";
import { LiveRobotics } from "./pages/LiveRobotics";
import { Simulation } from "./pages/Simulation";
import { TalkWithArya } from "./pages/TalkWithArya";
import styles from "./App.module.css";

function AppShell() {
  const { robot, setMode } = useRobotState();
  const [route, setRoute] = useState<RouteId>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);

  function navigate(next: RouteId) {
    setRoute(next);
    const modeMap: Record<RouteId, "HOME" | "LIVE" | "SIMULATION" | "TALK"> = {
      home: "HOME",
      live: "LIVE",
      simulation: "SIMULATION",
      talk: "TALK",
    };
    setMode(modeMap[next]);
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [route]);

  return (
    <div className={styles.shell}>
      <Header online={robot.online} onOpenSettings={() => setSettingsOpen(true)} />
      <div className={styles.body}>
        <Sidebar active={route} onNavigate={navigate} robot={robot} />
        <main className={styles.main}>
          {route === "home" && <Home onNavigate={navigate} />}
          {route === "live" && <LiveRobotics />}
          {route === "simulation" && <Simulation />}
          {route === "talk" && <TalkWithArya />}
        </main>
      </div>
      <MobileTabBar active={route} onNavigate={navigate} />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default function App() {
  const [booted, setBooted] = useState(false);

  return (
    <RobotStateProvider>
      {!booted && <Boot onComplete={() => setBooted(true)} />}
      {booted && <AppShell />}
    </RobotStateProvider>
  );
}
