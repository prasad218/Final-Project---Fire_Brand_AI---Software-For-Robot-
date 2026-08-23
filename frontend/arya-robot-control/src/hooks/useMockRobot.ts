import { useEffect, useRef, useState } from "react";
import type { LiveLogEntry, RecognizedPerson } from "../types/vision";
import { LIVE_LOG_SCRIPT, createInitialPeople, makeLogEntry } from "../services/mock/mockVision";

const LOG_INTERVAL_MS = 2600;
const MAX_LOG_ENTRIES = 30;

/** Drives a believable stream of mock perception log entries + people list. */
export function useMockRobot(active: boolean) {
  const [log, setLog] = useState<LiveLogEntry[]>([]);
  const [people, setPeople] = useState<RecognizedPerson[]>(createInitialPeople());
  const scriptIndex = useRef(0);

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      const message = LIVE_LOG_SCRIPT[scriptIndex.current % LIVE_LOG_SCRIPT.length];
      scriptIndex.current += 1;
      setLog((prev) => [...prev.slice(-MAX_LOG_ENTRIES + 1), makeLogEntry(message)]);
    }, LOG_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [active]);

  return { log, people, setPeople };
}
