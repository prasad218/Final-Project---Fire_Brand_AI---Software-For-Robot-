import { useState } from "react";
import { Gamepad2, Mic, Navigation2 } from "lucide-react";
import { useSimulation } from "../hooks/useSimulation";
import { useKeyboardDrive } from "../hooks/useKeyboardDrive";
import { SimulationEnvironment } from "../components/simulation/SimulationEnvironment";
import { SimulationControls } from "../components/simulation/SimulationControls";
import { CorridorMiniMap } from "../components/simulation/CorridorMiniMap";
import { AutoDrivePanel } from "../components/simulation/AutoDrivePanel";
import { SimulationStatus } from "../components/simulation/SimulationStatus";
import { VoiceCommandPanel } from "../components/live/VoiceCommandPanel";
import { STATIONS } from "../components/simulation/stations";
import styles from "./Simulation.module.css";

type DriveMode = "controls" | "voice" | "auto";

export function Simulation() {
  const {
    robot,
    sendCommand,
    trail,
    selectedStationId,
    setSelectedStationId,
    navigationTarget,
    driveToStation,
    cancelNavigation,
    patrolLeg,
    startPatrol,
    cancelPatrol,
  } = useSimulation();
  const [mode, setMode] = useState<DriveMode>("controls");

  // WASD / arrow keys drive ARYA the same way the on-screen pad does —
  // only while the Controls tab is open, so typing elsewhere never steals
  // keystrokes.
  useKeyboardDrive(mode === "controls");

  function handleGoToStation(stationId: string) {
    const station = STATIONS.find((s) => s.id === stationId);
    if (!station) return;
    setSelectedStationId(stationId);
    driveToStation(stationId, station.position);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>3D Simulation</h1>
        <p className={styles.subtitle}>
          Orbit and zoom the building, then drive ARYA from the door, down the corridor, and back.
        </p>
      </div>

      <div className={styles.modeToggle} role="tablist" aria-label="Drive mode">
        <button
          role="tab"
          aria-selected={mode === "controls"}
          className={[styles.modeBtn, mode === "controls" ? styles.modeBtnActive : ""].join(" ")}
          onClick={() => setMode("controls")}
        >
          <Gamepad2 size={14} /> Controls
        </button>
        <button
          role="tab"
          aria-selected={mode === "voice"}
          className={[styles.modeBtn, mode === "voice" ? styles.modeBtnActive : ""].join(" ")}
          onClick={() => setMode("voice")}
        >
          <Mic size={14} /> Voice
        </button>
        <button
          role="tab"
          aria-selected={mode === "auto"}
          className={[styles.modeBtn, mode === "auto" ? styles.modeBtnActive : ""].join(" ")}
          onClick={() => setMode("auto")}
        >
          <Navigation2 size={14} /> Automatic
        </button>
      </div>

      <div className={styles.layout}>
        <div className={styles.canvasWrap}>
          <SimulationEnvironment
            position={robot.position}
            rotation={robot.rotation}
            action={robot.action}
            trail={trail}
            selectedStationId={selectedStationId}
            onSelectStation={setSelectedStationId}
          />
        </div>

        <div className={styles.sideColumn}>
          <SimulationStatus robot={robot} />

          {mode === "controls" && <SimulationControls onCommand={sendCommand} />}
          {mode === "voice" && <VoiceCommandPanel onCommand={sendCommand} />}
          {mode === "auto" && (
            <AutoDrivePanel
              navigationTarget={navigationTarget}
              patrolLeg={patrolLeg}
              action={robot.action}
              onGo={handleGoToStation}
              onCancel={cancelNavigation}
              onStartPatrol={startPatrol}
              onCancelPatrol={cancelPatrol}
            />
          )}

          <CorridorMiniMap position={robot.position} rotation={robot.rotation} trail={trail} />
        </div>
      </div>
    </div>
  );
}
