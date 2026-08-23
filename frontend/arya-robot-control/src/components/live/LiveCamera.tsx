import { useEffect, useState } from "react";
import { CameraOff, ScanEye } from "lucide-react";
import type { DetectedObject } from "../../types/vision";
import { ENDPOINTS } from "../../config";
import styles from "./LiveCamera.module.css";

interface LiveCameraProps {
  objects: DetectedObject[];
  active: boolean;
}

/**
 * Displays ARYA's live camera feed — but NOT via the browser's own
 * getUserMedia(). The camera itself runs headless on the backend (see
 * vision_service.py: it never opens a cv2 window) and is captured +
 * run through YOLO object/person detection + InsightFace recognition
 * continuously, independent of whether anyone's looking at this page.
 * This component just displays the backend's already-annotated MJPEG
 * stream (GET /api/vision/mjpeg) — bounding boxes and name labels are
 * baked into the JPEG frames server-side, so there's no separate
 * client-side overlay to keep in sync with detection coordinates.
 */
export function LiveCamera({ objects, active }: LiveCameraProps) {
  const [nonce, setNonce] = useState(0);
  const [streamError, setStreamError] = useState(false);

  // Fresh connection each time this view becomes active (e.g.
  // navigating back to Live Robotics), rather than reusing a stream
  // handle that may have gone stale while the page was hidden.
  useEffect(() => {
    if (!active) return;
    setStreamError(false);
    setNonce((n) => n + 1);
  }, [active]);

  // If the stream errors (backend not up yet, camera still loading),
  // retry every few seconds instead of staying broken for the rest of
  // the session.
  useEffect(() => {
    if (!streamError || !active) return;
    const timer = setTimeout(() => {
      setStreamError(false);
      setNonce((n) => n + 1);
    }, 4000);
    return () => clearTimeout(timer);
  }, [streamError, active]);

  const streamUrl = `${ENDPOINTS.visionMjpeg}?t=${nonce}`;

  return (
    <div className={styles.viewport}>
      {active && !streamError ? (
        <img
          key={nonce}
          src={streamUrl}
          alt="ARYA live camera feed"
          className={styles.video}
          onError={() => setStreamError(true)}
        />
      ) : (
        <div className={styles.placeholder}>
          <ScanEye size={40} />
          <p>
            {!active
              ? "Camera inactive"
              : "Connecting to ARYA's camera — check the backend (web_server.py) is running"}
          </p>
        </div>
      )}

      <div className={styles.scan} />

      <div className={styles.hudTopLeft}>
        <CameraOff size={12} className={styles.hidden} />
        <span className={styles.recDot} /> LIVE
      </div>

      <div className={styles.hudBottomLeft}>
        {objects.length > 0 ? (
          objects.slice(0, 3).map((o) => (
            <span key={o.id}>
              {o.label} &times;{o.count}
            </span>
          ))
        ) : (
          <span>No objects detected</span>
        )}
      </div>
    </div>
  );
}
