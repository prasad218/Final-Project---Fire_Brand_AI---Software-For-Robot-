import { useEffect, useRef } from "react";
import { MapPin } from "lucide-react";
import { Panel } from "../common/Panel";
import { FLOORPLAN_SEGMENTS } from "../../world/worldBounds";
import type { Vector3Like } from "../../types/robot";
import styles from "./CorridorMiniMap.module.css";

interface CorridorMiniMapProps {
  position: Vector3Like;
  rotation: number; // degrees
  trail: Vector3Like[];
}

/** A live top-down floorplan of the lobby + corridor, with the robot's trail
 * and current heading -- "where does it go", drawn from the same world
 * bounds the 3D scene and the drive-engine collision use. */
export function CorridorMiniMap({ position, rotation, trail }: CorridorMiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, w, h);

    const scale = 5.6;
    const cx = w / 2;
    const cy = h / 2;
    const px = position.x;
    const pz = position.z;

    // faint grid
    ctx.strokeStyle = "rgba(56,211,255,0.08)";
    ctx.lineWidth = 1;
    const gridStep = 22;
    const offX = (((-px * scale) % gridStep) + gridStep) % gridStep;
    const offY = (((-pz * scale) % gridStep) + gridStep) % gridStep;
    for (let x = offX; x < w; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = offY; y < h; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // building outline
    ctx.strokeStyle = "rgba(79,214,255,0.8)";
    ctx.lineWidth = 2.5;
    FLOORPLAN_SEGMENTS.forEach(([x1, z1, x2, z2]) => {
      ctx.beginPath();
      ctx.moveTo(cx + (x1 - px) * scale, cy + (z1 - pz) * scale);
      ctx.lineTo(cx + (x2 - px) * scale, cy + (z2 - pz) * scale);
      ctx.stroke();
    });

    // trail
    if (trail.length > 1) {
      ctx.strokeStyle = "#34e3a1";
      ctx.lineWidth = 2;
      ctx.beginPath();
      trail.forEach((p, i) => {
        const sx = cx + (p.x - px) * scale;
        const sy = cy + (p.z - pz) * scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }

    // robot marker (arrow). Forward in world space is (sin(rot), cos(rot))
    // in degrees; mapped to this canvas's screen-space rotation that's
    // (180 - rot) so the arrow visually points the way ARYA is facing.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((180 - rotation) * Math.PI) / 180);
    ctx.fillStyle = "#38d3ff";
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // vignette ring
    ctx.strokeStyle = "rgba(56,211,255,0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
  }, [position, rotation, trail]);

  return (
    <Panel title="Live Map" icon={<MapPin size={14} />} accent="cyan">
      <canvas ref={canvasRef} className={styles.canvas} />
      <p className={styles.hint}>Tracks ARYA's live position and path through the door → lobby → corridor.</p>
    </Panel>
  );
}
