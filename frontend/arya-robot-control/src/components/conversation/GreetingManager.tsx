import { useState } from "react";
import { HandHeart } from "lucide-react";
import type { GreetingManagerState, GreetingQueueEntry } from "../../types/conversation";
import { Panel } from "../common/Panel";
import { StatusIndicator } from "../common/StatusIndicator";
import { Button } from "../common/Button";
import { GreetingQueue } from "./GreetingQueue";
import styles from "./GreetingManager.module.css";

interface GreetingManagerProps {
  onNamaste: () => void;
  onLog: (message: string) => void;
}

const INITIAL_QUEUE: GreetingQueueEntry[] = [
  { id: "gq-shankar", personName: "Shankar", status: "COMPLETED", queuedAt: Date.now() },
  { id: "gq-unknown-1", personName: "Unknown #01", status: "WAITING", queuedAt: Date.now() },
];

const STATE_TONE: Record<GreetingManagerState, "green" | "cyan" | "orange"> = {
  READY: "green",
  CHECKING_PRESENCE: "orange",
  GREETING: "cyan",
};

export function GreetingManager({ onNamaste, onLog }: GreetingManagerProps) {
  const [queue, setQueue] = useState<GreetingQueueEntry[]>(INITIAL_QUEUE);
  const [state, setState] = useState<GreetingManagerState>("READY");

  function runTestNamaste() {
    if (state !== "READY") return;
    const target = queue.find((e) => e.status === "WAITING");

    setState("CHECKING_PRESENCE");
    onLog(target ? `Checking presence: ${target.personName}` : "Checking presence");

    setTimeout(() => {
      setState("GREETING");
      onNamaste();
      onLog(target ? `Greeting started: ${target.personName}` : "Greeting started");

      setTimeout(() => {
        if (target) {
          setQueue((prev) =>
            prev.map((e) => (e.id === target.id ? { ...e, status: "COMPLETED" } : e)),
          );
          onLog(`Namaste completed: ${target.personName}`);
        } else {
          onLog("Namaste completed");
        }
        setState("READY");
      }, 1400);
    }, 700);
  }

  return (
    <Panel title="Greeting Manager" icon={<HandHeart size={14} />} accent="orange">
      <div className={styles.stateRow}>
        <span className={styles.stateLabel}>Current state</span>
        <StatusIndicator label={state.replace("_", " ")} tone={STATE_TONE[state]} />
      </div>

      <p className={styles.caption}>Presence is checked before every Namaste.</p>

      <GreetingQueue entries={queue} />

      <Button
        accent="orange"
        variant="solid"
        className={styles.testBtn}
        onClick={runTestNamaste}
        disabled={state !== "READY"}
      >
        Test Namaste
      </Button>
    </Panel>
  );
}
