import { Navigation2, Square, RouteOff, DoorOpen } from "lucide-react";
import type { RobotAction } from "../../types/robot";
import type { PatrolLeg } from "../../hooks/useRobotState";
import { Panel } from "../common/Panel";
import { STATIONS } from "./stations";
import type { NavigationTarget } from "../../hooks/useRobotState";
import styles from "./AutoDrivePanel.module.css";

interface AutoDrivePanelProps {
  navigationTarget: NavigationTarget | null;
  patrolLeg: PatrolLeg;
  action: RobotAction;
  onGo: (stationId: string) => void;
  onCancel: () => void;
  onStartPatrol: () => void;
  onCancelPatrol: () => void;
  /** The named-station list ("Reception", "Room 101", ...) drives to
   * fixed points in the simulated building -- appropriate on 3D
   * Simulation, but out of place on the live camera page where
   * "Automatic" should mean the real Corridor Patrol route, not a
   * planned/simulated waypoint picker. Defaults to true so the
   * Simulation page needs no change. */
  showStationList?: boolean;
}

export function AutoDrivePanel({
  navigationTarget,
  patrolLeg,
  action,
  onGo,
  onCancel,
  onStartPatrol,
  onCancelPatrol,
  showStationList = true,
}: AutoDrivePanelProps) {
  const activeStation = navigationTarget ? STATIONS.find((s) => s.id === navigationTarget.stationId) : null;
  const busy = !!navigationTarget || !!patrolLeg;
  const arrived = !busy && action === "IDLE";

  return (
    <>
      <Panel title="Corridor Patrol" icon={<Navigation2 size={14} />} accent="green">
        <p className={styles.hint}>
          ARYA drives herself from the door, all the way down the corridor to the far window, then back to the
          door — no input needed.
        </p>

        {patrolLeg ? (
          <div className={styles.activeBar}>
            <span className={styles.patrolStatus}>
              <DoorOpen size={13} />
              {patrolLeg === "TO_CORRIDOR_END" ? "Heading to the corridor end…" : "Returning to the door…"}
            </span>
            <button className={styles.cancelBtn} onClick={onCancelPatrol} aria-label="Cancel patrol">
              <Square size={12} /> Stop
            </button>
          </div>
        ) : (
          <button className={styles.patrolBtn} onClick={onStartPatrol} disabled={!!navigationTarget}>
            <Navigation2 size={15} /> Start Corridor Patrol
          </button>
        )}
      </Panel>

      {showStationList && (
        <Panel title="Auto Navigate" icon={<RouteOff size={14} />} accent="green">
          <p className={styles.hint}>Or pick a specific point and ARYA will plan and drive the path there on her own.</p>

          <ul className={styles.list}>
            {STATIONS.map((station) => {
              const isActive = navigationTarget?.stationId === station.id;
              return (
                <li key={station.id}>
                  <button
                    className={[styles.item, isActive ? styles.active : ""].join(" ")}
                    onClick={() => onGo(station.id)}
                    disabled={isActive || !!patrolLeg}
                    style={{ ["--dot" as string]: station.color }}
                  >
                    <span className={styles.dot} />
                    <span className={styles.name}>{station.name}</span>
                    <span className={styles.status}>{isActive ? "Navigating…" : "Go"}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {navigationTarget ? (
            <div className={styles.activeBar}>
              <span>
                Navigating to <strong>{activeStation?.name ?? "station"}</strong>&hellip;
              </span>
              <button className={styles.cancelBtn} onClick={onCancel} aria-label="Cancel navigation">
                <Square size={12} /> Stop
              </button>
            </div>
          ) : (
            arrived && <p className={styles.arrived}>ARYA is idle and ready for the next destination.</p>
          )}
        </Panel>
      )}
    </>
  );
}
