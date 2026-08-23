import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Cpu, Eye, Mic, BrainCircuit, Box, CheckCircle2, Circle, Loader2, Flame } from "lucide-react";
import { AryaRobot } from "../components/robot/AryaRobot";
import type { SystemModule } from "../types/robot";
import styles from "./Boot.module.css";

/**
 * The Boot canvas has no OrbitControls, so the default camera just faces
 * down -Z from its position with no aim — it doesn't automatically look at
 * the robot. This keeps it centered on ARYA's chest/face every frame.
 */
function CameraRig() {
  useFrame(({ camera }) => {
    camera.lookAt(0, 0.5, 0);
  });
  return null;
}

const MODULES: SystemModule[] = [
  { id: "CORE_SYSTEM", label: "Core System", status: "PENDING" },
  { id: "VISION_ENGINE", label: "Vision Engine", status: "PENDING" },
  { id: "VOICE_INTERFACE", label: "Voice Interface", status: "PENDING" },
  { id: "BEHAVIOUR_ENGINE", label: "Behaviour Engine", status: "PENDING" },
  { id: "SIMULATION_ENGINE", label: "Simulation Engine", status: "PENDING" },
];

const MODULE_ICONS = {
  CORE_SYSTEM: Cpu,
  VISION_ENGINE: Eye,
  VOICE_INTERFACE: Mic,
  BEHAVIOUR_ENGINE: BrainCircuit,
  SIMULATION_ENGINE: Box,
};

interface BootProps {
  onComplete: () => void;
}

// Same wording shown in the speech bubble below ("Namaste! I am ARYA.
// Systems are ready.") -- kept as one constant so the spoken line and
// the displayed line can never drift apart.
const GREETING_LINE = "Namaste! I am ARYA. Systems are ready.";

export function Boot({ onComplete }: BootProps) {
  const [progress, setProgress] = useState(0);
  const [modules, setModules] = useState(MODULES);
  const [phase, setPhase] = useState<"booting" | "ready" | "greeting" | "leaving">("booting");
  // Guards against speaking twice — StrictMode/fast re-renders could
  // otherwise re-enter the "greeting" branch of the effect below.
  const hasSpokenGreetingRef = useRef(false);

  // Speaks the boot greeting out loud the moment the speech bubble
  // appears, instead of only showing it silently as before. Runs once,
  // guarded by hasSpokenGreetingRef, and cancels itself on unmount so a
  // fast page nav away from Boot doesn't leave a stray voice line
  // playing over whatever screen comes next.
  useEffect(() => {
    if (phase !== "greeting" && phase !== "leaving") return;
    if (hasSpokenGreetingRef.current) return;
    if (!("speechSynthesis" in window)) return;
    hasSpokenGreetingRef.current = true;

    window.speechSynthesis.cancel();
    const timer = setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(GREETING_LINE);
      utterance.lang = "en-IN";
      window.speechSynthesis.speak(utterance);
    }, 60); // see CANCEL_SETTLE_MS in TalkWithArya.tsx -- avoids Chrome
    // silently dropping an utterance spoken in the same tick as cancel().

    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    return () => {
      // Leaving the Boot screen entirely (onComplete fired) -- don't
      // let the greeting line keep playing into the Home page.
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return prev;
        const next = Math.min(100, prev + 1.4);
        setModules((prevModules) =>
          prevModules.map((mod, i) => {
            const startAt = i * 18;
            const okAt = startAt + 14;
            if (next >= okAt) return { ...mod, status: "OK" };
            if (next >= startAt) return { ...mod, status: "INITIALIZING" };
            return mod;
          }),
        );
        if (next >= 100) {
          // Boot sequence just completed — schedule the ready/greeting/leaving hand-off
          // from this event rather than a separate effect watching `progress`.
          setPhase("ready");
          setTimeout(() => setPhase("greeting"), 900);
          setTimeout(() => setPhase("leaving"), 3200);
          setTimeout(() => onComplete(), 3800);
        }
        return next;
      });
    }, 55);
    return () => clearInterval(id);
  }, [onComplete]);

  const eyesOn = progress > 12;

  return (
    <div className={[styles.stage, phase === "leaving" ? styles.leaving : ""].join(" ")}>
      <div className={styles.scan} />
      <div className={styles.grid}>
        <div className={styles.left}>
          <div className={styles.logoRow}>
            <span className={styles.logoIcon}>
              <Flame size={20} />
            </span>
            <div>
              <div className={styles.brand}>ARYA</div>
              <div className={styles.brandSub}>Robot Control Center</div>
            </div>
          </div>

          <h1 className={styles.headline}>
            INITIALIZING <span className={styles.cyan}>ARYA</span>
          </h1>
          <p className={styles.sub}>An Open Robotic Software Platform</p>
          <p className={styles.tags}>Powered by AI &bull; Computer Vision &bull; Robotics &bull; Generative AI</p>

          <div className={styles.progressWrap}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
            <span className={styles.progressLabel}>{Math.round(progress)}%</span>
          </div>
          <div className={styles.progressCaption}>
            {phase === "booting" ? "Initializing robotic intelligence..." : "All systems ready"}
          </div>

          <ul className={styles.moduleList}>
            {modules.map((mod) => {
              const Icon = MODULE_ICONS[mod.id];
              return (
                <li key={mod.id} className={styles.moduleItem}>
                  <span className={styles.moduleLabel}>
                    <Icon size={14} />
                    {mod.label}
                  </span>
                  <span className={[styles.moduleStatus, styles[mod.status]].join(" ")}>
                    {mod.status === "OK" && <CheckCircle2 size={14} />}
                    {mod.status === "INITIALIZING" && <Loader2 size={14} className={styles.spin} />}
                    {mod.status === "PENDING" && <Circle size={12} />}
                    {mod.status === "OK" ? "OK" : mod.status === "INITIALIZING" ? "INITIALIZING…" : "PENDING"}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className={styles.footerRow}>
            <span className={styles.footerLabel}>Built by</span>
            <span className={styles.footerBrand}>FIRE BRAND AI</span>
            <span className={styles.footerVersion}>ARYA v1.0.0</span>
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.rings} />
          <Canvas camera={{ position: [0, 1.1, 3.4], fov: 38 }} shadows>
            <ambientLight intensity={0.5} />
            <directionalLight position={[3, 5, 2]} intensity={1.1} castShadow />
            <pointLight position={[-2, 1, -2]} intensity={0.4} color="#38d3ff" />
            <CameraRig />
            {/* Subtle head-only "look up" during the greeting, instead of
                a fully static IDLE pose -- RobotAnimationController's
                "LOOK" action moves just lookOffset (a few % of head
                width/height, see AryaHead.tsx), not the whole body, so
                this reads as ARYA glancing up/around as she greets you,
                not a big motion. */}
            <AryaRobot
              action={phase === "greeting" || phase === "leaving" ? "LOOK" : "IDLE"}
              eyesOn={eyesOn}
              position={[0, -0.9, 0]}
              scale={1.25}
            />
          </Canvas>

          {phase === "greeting" || phase === "leaving" ? (
            <div className={styles.speechBubble}>
              <p>
                <strong>Namaste!</strong> I am ARYA.
              </p>
              <p className={styles.speechSub}>Systems are ready.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
