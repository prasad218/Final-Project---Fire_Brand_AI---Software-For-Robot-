import { useEffect } from "react";
import { useRobotState, type DriveFlags } from "./useRobotState";

const KEY_MAP: Record<string, keyof DriveFlags> = {
  ArrowUp: "fwd",
  KeyW: "fwd",
  ArrowDown: "back",
  KeyS: "back",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

/** WASD / arrow-key driving, mirroring the on-screen hold buttons. Space bar
 * hard-stops. Only active while `enabled` is true, so it doesn't fight with
 * text inputs on other pages (chat, settings, etc). */
export function useKeyboardDrive(enabled: boolean) {
  const { setDrive, sendCommand } = useRobotState();

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const flag = KEY_MAP[e.code];
      if (flag) {
        setDrive({ [flag]: true } as Partial<DriveFlags>);
        e.preventDefault();
      } else if (e.code === "Space") {
        sendCommand("STOP");
        e.preventDefault();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      const flag = KEY_MAP[e.code];
      if (flag) {
        setDrive({ [flag]: false } as Partial<DriveFlags>);
        e.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled, setDrive, sendCommand]);
}
