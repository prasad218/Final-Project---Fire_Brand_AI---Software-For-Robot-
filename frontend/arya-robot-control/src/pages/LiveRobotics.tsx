import { useEffect, useRef, useState } from "react";
import { Gamepad2, Mic, Navigation2 } from "lucide-react";
import { useSimulation } from "../hooks/useSimulation";
import { useVisionFeed } from "../hooks/useVisionFeed";
import { useUnifiedLog } from "../hooks/useUnifiedLog";
import { useKeyboardDrive } from "../hooks/useKeyboardDrive";
import { LiveCamera } from "../components/live/LiveCamera";
import { VoiceCommandPanel } from "../components/live/VoiceCommandPanel";
import { MovementControls } from "../components/live/MovementControls";
import { VisionObjects } from "../components/live/VisionObjects";
import { RecognizedPeople } from "../components/live/RecognizedPeople";
import { LiveRobotLog } from "../components/live/LiveRobotLog";
import { RobotDigitalTwin } from "../components/live/RobotDigitalTwin";
import { RobotStatus } from "../components/robot/RobotStatus";
import { AutoDrivePanel } from "../components/simulation/AutoDrivePanel";
import { STATIONS } from "../components/simulation/stations";
import { sendRobotCommand } from "../services/real/robotClient";
import type { VoiceCommand } from "../types/robot";
import styles from "./LiveRobotics.module.css";

type DriveMode = "controls" | "voice" | "auto";

export function LiveRobotics() {
  // useSimulation wraps the same shared robot state used by 3D Simulation,
  // plus the movement trail — so voice/movement commands issued here drive
  // the exact same position/rotation the Simulation page would show, and
  // Automatic mode's Corridor Patrol works identically on both pages.
  const {
    robot,
    sendCommand,
    trail,
    navigationTarget,
    driveToStation,
    cancelNavigation,
    patrolLeg,
    startPatrol,
    cancelPatrol,
  } = useSimulation();
  const [mode, setMode] = useState<DriveMode>("controls");

  useKeyboardDrive(mode === "controls");

  // Real object detection / person detection / face recognition, live
  // from the backend's headless camera pipeline (vision_service.py) —
  // not mock data. The socket stays open the whole time this page is
  // mounted; robot.cameraActive just controls whether <LiveCamera>
  // requests the MJPEG stream (the backend's camera itself keeps
  // running regardless, see the note in vision_service.py).
  //
  // greetingActive mirrors the backend's real greeting queue
  // (vision_service.py's _update_registry -> snapshot()'s
  // "greetingActive" field) -- the same signal TalkWithArya.tsx uses to
  // trigger the Namaste animation when someone is actually being
  // greeted, rather than only on the manual "Namaste" test button.
  const { objects, people, log, greetingActive } = useVisionFeed(true);

  // Merges the backend's real log with client-side movement events
  // (distance driven, drive start/stop, automatic patrol progress) —
  // there's no physical robot reporting real telemetry, so movement
  // only exists client-side and needs to be logged client-side too.
  const unifiedLog = useUnifiedLog(log, robot.action, robot.distanceTraveledM, robot.position, patrolLeg);

  // Only react once per real greeting, not on every render while
  // greetingActive stays the same name.
  const lastGreetedRef = useRef<string | null>(null);

  function handleCommand(command: VoiceCommand) {
    sendCommand(command);
    // Fire-and-forget: also tell the backend's MovementController /
    // GestureController about this command so it's logged server-side
    // (and drives real hardware if this is ever run on the robot's own
    // PC with ENABLE_GPIO=true) — see services/real/robotClient.ts.
    void sendRobotCommand(command);
  }

  function handleGoToStation(stationId: string) {
    const station = STATIONS.find((s) => s.id === stationId);
    if (!station) return;
    driveToStation(stationId, station.position);
  }

  // Reacts to the backend's real greeting queue so the digital twin on
  // THIS page also plays Namaste when the camera pipeline actually
  // greets someone — not just when TalkWithArya is mounted. This does
  // NOT call sendRobotCommand: the backend already triggered its own
  // gesture server-side, so this only reacts client-side, it doesn't
  // ask the backend to greet again.
  useEffect(() => {
    if (greetingActive && greetingActive !== lastGreetedRef.current) {
      lastGreetedRef.current = greetingActive;
      sendCommand("NAMASTE");
    } else if (!greetingActive) {
      lastGreetedRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greetingActive]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>VCET Live </h1>
          <p className={styles.subtitle}>
            Real-time perception and control — object detection, person detection, and face
            recognition run live on ARYA's backend at VCET.
          </p>
        </div>
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
        <div className={styles.mainColumn}>
          <LiveCamera objects={objects} active={robot.cameraActive} />
          <RobotDigitalTwin
            position={robot.position}
            rotation={robot.rotation}
            action={robot.action}
            trail={trail}
            distanceTraveledM={robot.distanceTraveledM}
            people={people}
          />
          <LiveRobotLog entries={unifiedLog} title="Live Robot Log" />
        </div>

        <div className={styles.sideColumn}>
          <RobotStatus robot={robot} />

          {mode === "controls" && <MovementControls onCommand={handleCommand} action={robot.action} />}
          {mode === "voice" && <VoiceCommandPanel onCommand={handleCommand} />}
          {mode === "auto" && (
            <AutoDrivePanel
              navigationTarget={navigationTarget}
              patrolLeg={patrolLeg}
              action={robot.action}
              onGo={handleGoToStation}
              onCancel={cancelNavigation}
              onStartPatrol={startPatrol}
              onCancelPatrol={cancelPatrol}
              showStationList={false}
            />
          )}
          <RecognizedPeople people={people} />
        </div>
      </div>
    </div>
  );
}