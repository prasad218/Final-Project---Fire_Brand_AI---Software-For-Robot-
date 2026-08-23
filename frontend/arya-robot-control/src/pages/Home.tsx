import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Video, Box, MessageCircle, Eye, Mic, BrainCircuit, Cog, Radar } from "lucide-react";
import { AryaRobot } from "../components/robot/AryaRobot";
import { ExperienceCard } from "../components/common/ExperienceCard";
import type { RouteId } from "../components/layout/Sidebar";
import styles from "./Home.module.css";

interface HomeProps {
  onNavigate: (route: RouteId) => void;
}

const SYSTEM_CHIPS = [
  { label: "Vision", icon: Eye },
  { label: "Voice", icon: Mic },
  { label: "AI Engine", icon: BrainCircuit },
  { label: "Motors", icon: Cog },
  { label: "Sensors", icon: Radar },
];

export function Home({ onNavigate }: HomeProps) {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>Namaste! 👋</p>
          <h1 className={styles.title}>
            I am <span className={styles.cyan}>ARYA</span>
          </h1>
          <p className={styles.subtitle}>Your AI-powered robotic assistant.</p>
          <p className={styles.description}>
            I can see, understand, interact and move in the real world and in simulation.
          </p>
        </div>

        <div className={styles.heroCanvas}>
          <Canvas camera={{ position: [0, 1.4, 3.4], fov: 38 }} shadows>
            <ambientLight intensity={0.55} />
            <directionalLight position={[3, 5, 2]} intensity={1.1} castShadow />
            <pointLight position={[-2, 1, -1]} intensity={0.35} color="#38d3ff" />
          <AryaRobot action="IDLE" eyesOn position={[0, -1.6, 0]} scale={1.3} />
            <OrbitControls
              enablePan={false}
              enableZoom={false}
              minPolarAngle={Math.PI / 2.6}
              maxPolarAngle={Math.PI / 2.1}
              autoRotate
              autoRotateSpeed={0.6}
            />
          </Canvas>
        </div>
      </section>

      <section className={styles.cards}>
        <ExperienceCard
          eyebrow="Live"
          icon={<Video size={13} />}
          accent="cyan"
          title="VCET Live Demo"
          description="Control ARYA in real-time using live camera, voice commands and intelligent perception."
          ctaLabel="Enter Live Demo"
          onSelect={() => onNavigate("live")}
        />
        <ExperienceCard
          eyebrow="3D"
          icon={<Box size={13} />}
          accent="green"
          title="Experience a 3D Simulation"
          description="Explore a pre-built robotic station and simulate ARYA's movements in an interactive 3D environment."
          ctaLabel="Enter Simulation"
          onSelect={() => onNavigate("simulation")}
        />
        <ExperienceCard
          eyebrow="Talk"
          icon={<MessageCircle size={13} />}
          accent="purple"
          title="Talk with ARYA"
          description="Have a conversation with ARYA and experience intelligent robotic interaction."
          ctaLabel="Start Conversation"
          onSelect={() => onNavigate("talk")}
        />
      </section>

      <section className={styles.chipRow}>
        {SYSTEM_CHIPS.map(({ label, icon: Icon }) => (
          <span key={label} className={styles.chip}>
            <Icon size={13} />
            {label}
            <span className={styles.chipDot} />
          </span>
        ))}
      </section>
    </div>
  );
}
