import { useEffect, useState } from "react";
import { CameraOff, RefreshCw, ScanEye, Server, Smartphone } from "lucide-react";
import type { DetectedObject } from "../../types/vision";
import { ENDPOINTS } from "../../config";
import { useClientCamera } from "../../hooks/useClientCamera";
import styles from "./LiveCamera.module.css";

interface LiveCameraProps {
  objects: DetectedObject[];
  active: boolean;
}

type CameraSource = "server" | "client";

/**
 * Displays ARYA's live camera feed from either of two sources, toggled
 * top-right of the viewport:
 *
 *  - "Server Webcam" (default, unchanged): the backend's own headless
 *    camera (vision_service.py's _loop(), never a local cv2 window)
 *    via the annotated MJPEG stream at GET /api/vision/mjpeg.
 *
 *  - "My Camera": THIS device's own camera (front by default on a
 *    laptop, back by default on a phone, flip button available) opened
 *    with getUserMedia. Frames are sent to WS /ws/vision-client, which
 *    runs them through the exact same YOLO + InsightFace pipeline
 *    server-side (VisionService.process_client_frame) and returns an
 *    annotated JPEG -- so both modes render identically, no separate
 *    client-side detection overlay to keep in sync.
 *
 * `objects` is still accepted (LiveRobotics passes it down) so the
 * caller doesn't need to change, but it's intentionally not rendered
 * here -- that HUD lives elsewhere in the UI.
 */
export function LiveCamera({ active }: LiveCameraProps) {
  const [source, setSource] = useState<CameraSource>("server");
  const [preferBack, setPreferBack] = useState(false);

  return (
    <div className={styles.viewport}>
      <div className={styles.sourceToggle} role="tablist" aria-label="Camera source">
        <button
          type="button"
          role="tab"
          aria-selected={source === "server"}
          className={[styles.sourceBtn, source === "server" ? styles.sourceBtnActive : ""].join(" ")}
          onClick={() => setSource("server")}
        >
          <Server size={12} /> Server Webcam
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === "client"}
          className={[styles.sourceBtn, source === "client" ? styles.sourceBtnActive : ""].join(" ")}
          onClick={() => setSource("client")}
        >
          <Smartphone size={12} /> My Camera
        </button>
        {source === "client" && (
          <button
            type="button"
            className={styles.flipBtn}
            onClick={() => setPreferBack((v) => !v)}
            title="Switch front/back camera"
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {source === "server" ? (
        <ServerCameraView active={active} />
      ) : (
        <ClientCameraView active={active} preferBack={preferBack} />
      )}

      <div className={styles.scan} />

      <div className={styles.hudTopLeft}>
        <CameraOff size={12} className={styles.hidden} />
        <span className={styles.recDot} /> LIVE
      </div>
    </div>
  );
}

/** Unchanged behaviour: backend's own headless webcam via annotated MJPEG. */
function ServerCameraView({ active }: { active: boolean }) {
  const [nonce, setNonce] = useState(0);
  const [streamError, setStreamError] = useState(false);

  useEffect(() => {
    if (!active) return;
    setStreamError(false);
    setNonce((n) => n + 1);
  }, [active]);

  useEffect(() => {
    if (!streamError || !active) return;
    const timer = setTimeout(() => {
      setStreamError(false);
      setNonce((n) => n + 1);
    }, 4000);
    return () => clearTimeout(timer);
  }, [streamError, active]);

  if (!active || streamError) {
    return (
      <div className={styles.placeholder}>
        <ScanEye size={40} />
        <p>
          {!active
            ? "Camera inactive"
            : "Connecting to ARYA's camera — check the backend (web_server.py) is running"}
        </p>
      </div>
    );
  }

  return (
    <img
      key={nonce}
      src={`${ENDPOINTS.visionMjpeg}?t=${nonce}`}
      alt="ARYA live camera feed"
      className={styles.video}
      onError={() => setStreamError(true)}
    />
  );
}

/** This device's OWN camera (getUserMedia), streamed to the backend for
 * detection and displayed as the returned annotated frame. */
function ClientCameraView({ active, preferBack }: { active: boolean; preferBack: boolean }) {
  const { videoRef, canvasRef, status, error, annotatedFrameUrl } = useClientCamera(active, preferBack);

  return (
    <>
      {/* Hidden capture scaffolding — never shown, just used to grab frames */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} muted playsInline className={styles.hiddenCapture} />
      <canvas ref={canvasRef} className={styles.hiddenCapture} />

      {annotatedFrameUrl ? (
        <img
          src={annotatedFrameUrl}
          alt="Your camera feed, annotated by ARYA's vision pipeline"
          className={styles.video}
        />
      ) : (
        <div className={styles.placeholder}>
          <ScanEye size={40} />
          <p>
            {status === "requesting" && "Requesting camera permission..."}
            {status === "denied" && (error ?? "Camera permission denied")}
            {status === "unavailable" && (error ?? "Camera not supported in this browser")}
            {status === "socket-error" && "Lost connection to backend — retrying..."}
            {status === "streaming" && "Waiting for the first processed frame..."}
            {status === "idle" && "Camera inactive"}
          </p>
        </div>
      )}
    </>
  );
}
