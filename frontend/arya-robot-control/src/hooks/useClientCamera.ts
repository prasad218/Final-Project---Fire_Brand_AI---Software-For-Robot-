import { useCallback, useEffect, useRef, useState } from "react";
import { ENDPOINTS } from "../config";

export type ClientCameraStatus =
  | "idle"
  | "requesting"
  | "streaming"
  | "denied"
  | "unavailable"
  | "socket-error";

export interface ClientCameraState {
  status: ClientCameraStatus;
  error: string | null;
  /** Object URL of the latest ANNOTATED frame the backend sent back
   * (boxes/name labels already baked in server-side by
   * VisionService.process_client_frame, same as the MJPEG path) --
   * this is what the UI should render, not the raw <video> element,
   * so both camera sources look identical. */
  annotatedFrameUrl: string | null;
}

const SEND_INTERVAL_MS = 150; // ~6-7 fps upload, plenty for this pipeline
const JPEG_QUALITY = 0.7;

/**
 * Opens THIS device's own camera (front by default on a laptop, back
 * by default on a phone -- toggle with `preferBack`) with getUserMedia,
 * and streams captured JPEG frames to the backend's WS
 * /ws/vision-client, which runs them through the exact same YOLO +
 * InsightFace pipeline VisionService already uses for the server
 * webcam and sends back an annotated JPEG.
 *
 * This hook owns a hidden <video> (camera preview, never shown) and a
 * hidden <canvas> (scratch space for grabbing frames) -- the UI should
 * render `annotatedFrameUrl`, not the video element directly.
 */
export function useClientCamera(active: boolean, preferBack = false) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastUrlRef = useRef<string | null>(null);
  const sendingRef = useRef(false);

  const [state, setState] = useState<ClientCameraState>({
    status: "idle",
    error: null,
    annotatedFrameUrl: null,
  });

  const cleanup = useCallback(() => {
    if (sendTimerRef.current) {
      clearInterval(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    socketRef.current?.close();
    socketRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (lastUrlRef.current) {
      URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      cleanup();
      setState((s) => ({ ...s, status: "idle", annotatedFrameUrl: null }));
      return;
    }

    let cancelled = false;

    async function start() {
      setState((s) => ({ ...s, status: "requesting", error: null }));

      if (!navigator.mediaDevices?.getUserMedia) {
        setState((s) => ({
          ...s,
          status: "unavailable",
          error: "Camera API not supported in this browser",
        }));
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: preferBack ? "environment" : "user" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: "denied",
          error: err instanceof Error ? err.message : "Camera permission denied",
        }));
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      const socket = new WebSocket(ENDPOINTS.visionClientSocket);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      function sendFrame() {
        if (sendingRef.current) return; // don't outrun the backend
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2 || socket.readyState !== WebSocket.OPEN) return;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        sendingRef.current = true;
        canvas.toBlob(
          (blob) => {
            sendingRef.current = false;
            if (blob && socket.readyState === WebSocket.OPEN) {
              blob.arrayBuffer().then((buf) => socket.send(buf));
            }
          },
          "image/jpeg",
          JPEG_QUALITY,
        );
      }

      socket.onopen = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "streaming" }));
        sendTimerRef.current = setInterval(sendFrame, SEND_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        const blob = new Blob([event.data as ArrayBuffer], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = url;
        setState((s) => ({ ...s, annotatedFrameUrl: url }));
      };

      socket.onerror = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "socket-error", error: "Lost connection to backend vision socket" }));
      };

      socket.onclose = () => {
        if (cancelled) return;
        setState((s) => (s.status === "streaming" ? { ...s, status: "socket-error" } : s));
      };
    }

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, preferBack, cleanup]);

  return { videoRef, canvasRef, ...state };
}
