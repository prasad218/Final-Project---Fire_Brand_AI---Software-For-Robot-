import { useEffect, useRef, useState } from "react";
import type { DetectedObject, LiveLogEntry, RecognizedPerson } from "../types/vision";
import { ENDPOINTS } from "../config";

export interface VisionFeedState {
  /** Is the WebSocket to the backend currently open? */
  connected: boolean;
  /** Is the backend's camera/model pipeline actually up and reading frames? */
  ready: boolean;
  /** starting | loading_faces | loading_yolo | opening_camera | running | error */
  status: string;
  error: string | null;
  objects: DetectedObject[];
  people: RecognizedPerson[];
  log: LiveLogEntry[];
  /** Display name of whoever the backend JUST greeted (vision_service.py's
   * _update_registry -> snapshot()'s "greetingActive" field), true for a
   * few seconds around the real greeting, then null again -- lets pages
   * react to a REAL face-recognition greeting (Namaste animation, spoken
   * "Namaste, <name>!") instead of only the manual test button. */
  greetingActive: string | null;
}

const INITIAL_STATE: VisionFeedState = {
  connected: false,
  ready: false,
  status: "connecting",
  error: null,
  objects: [],
  people: [],
  log: [],
  greetingActive: null,
};

/**
 * Connects to the backend's GET /ws/vision (vision_service.py, via
 * web_server.py) and keeps {objects, people, log} live-synced with
 * whatever the (hidden, headless) camera pipeline is currently seeing —
 * real YOLO object/person detection + InsightFace face recognition,
 * not mock data. Auto-reconnects with backoff if the backend isn't up
 * yet or the connection drops, so pages using this don't need to care
 * about startup ordering between frontend and backend.
 *
 * Multiple components/pages can call this independently (Live Robotics
 * and Talk with ARYA both do) — each gets its own socket to the same
 * single camera pipeline on the backend, which is cheap since the
 * backend just broadcasts its already-computed snapshot.
 */
export function useVisionFeed(active = true): VisionFeedState {
  const [state, setState] = useState<VisionFeedState>(INITIAL_STATE);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(ENDPOINTS.visionSocket);
      } catch {
        scheduleRetry();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        setState((prev) => ({ ...prev, connected: true }));
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Partial<VisionFeedState> & {
            type?: string;
          };
          setState({
            connected: true,
            ready: Boolean(msg.ready),
            status: msg.status ?? "unknown",
            error: msg.error ?? null,
            objects: msg.objects ?? [],
            people: msg.people ?? [],
            log: msg.log ?? [],
            greetingActive: (msg as { greetingActive?: string | null }).greetingActive ?? null,
          });
        } catch {
          // malformed frame — ignore, next push will self-correct
        }
      };

      socket.onclose = () => {
        setState((prev) => ({ ...prev, connected: false }));
        scheduleRetry();
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    function scheduleRetry() {
      if (cancelled || !activeRef.current) return;
      const delay = Math.min(10000, 1000 * 2 ** retryRef.current);
      retryRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [active]);

  return state;
}
