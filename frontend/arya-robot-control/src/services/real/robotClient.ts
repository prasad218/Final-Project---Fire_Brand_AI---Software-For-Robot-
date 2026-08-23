// Real robot command client. The 3D avatar's position/rotation stays a
// pure client-side simulation (services/mock/mockRobot.ts +
// useRobotState/useSimulation) — there's no physical robot chassis to
// report real telemetry from here. What THIS does is forward every
// command the UI already issues (MovementControls, VoiceCommandPanel,
// chat) to the backend's MovementController/GestureController
// (vivek_interaction.py / vivek_face.py) so it's actually logged
// server-side and — if this ever runs on the robot's own hardware with
// ENABLE_GPIO=true in the backend's .env — actually drives the motors/
// servos, with zero UI changes needed on this end either way.
//
// Fire-and-forget by design: a command should never fail to move the
// 3D avatar just because the backend is unreachable, so failures here
// are swallowed (and logged to the console) rather than surfaced.

import { ENDPOINTS } from "../../config";
import type { VoiceCommand } from "../../types/robot";

export async function sendRobotCommand(command: VoiceCommand): Promise<void> {
  try {
    const res = await fetch(ENDPOINTS.robotCommand, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (!res.ok) throw new Error(`robot command endpoint returned ${res.status}`);
  } catch (err) {
    // Non-fatal: the on-screen/3D robot already moved via the local
    // simulation regardless of whether the backend heard about it.
    console.warn("[robotClient] command not delivered to backend:", err);
  }
}
