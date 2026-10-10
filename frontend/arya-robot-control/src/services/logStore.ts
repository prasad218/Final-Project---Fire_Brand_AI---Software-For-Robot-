// ============================================================================
// ARYA WEB — LOG STORE (saves the two on-screen logs to a cloud database)
//
// Saves every line shown in "Live Robot Log" (Live Robotics page) and
// "Talk Live Log" (Talk with ARYA page) to a Supabase table, straight
// from the browser. The backend and the tunnel are NOT involved at all.
//
// Uses Supabase's plain REST API through fetch(), so there is no npm
// package to install.
//
// Safe to deploy before the database exists: if the two env vars below
// aren't set, every function here does nothing.
//
//   VITE_SUPABASE_URL       e.g. https://abcdxyz.supabase.co
//   VITE_SUPABASE_ANON_KEY  the project's anon / publishable key
//
// Notes on how it behaves:
//  - Only saves while someone has the page open in a browser. If no tab
//    is open, nothing is recorded.
//  - Duplicates never create a second row (entry_id is the primary key):
//    backend log ids are stable ("log-<ms>-<seq>"), so two open browsers,
//    or both pages, saving the same backend event produce a single row.
//    This uses plain inserts, NOT "ON CONFLICT DO NOTHING": Postgres only
//    allows that for roles that may also read the table, and the table is
//    deliberately insert-only for the website (the logs hold people's
//    names). If a batch collides with an existing row, it is retried one
//    row at a time and the colliding rows are skipped.
//  - Best effort: a failed save is skipped, not retried, so a database
//    outage can never slow down or break the app.
// ============================================================================

import { useEffect, useRef } from "react";
import type { LiveLogEntry } from "../types/vision";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const LOG_STORE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);

export type LogPage = "live" | "talk";

// Every log id carries the epoch-millisecond time the event happened
// ("log-1738000000000-3", "client-1738000000000-7"), so the real event
// time can be recovered even for old backend entries replayed when a
// page first loads.
function eventTimeFromId(id: string): string {
  const match = id.match(/-(\d{12,14})(?:-|$)/);
  const ms = match ? Number(match[1]) : Date.now();
  return new Date(ms).toISOString();
}

let warned = false;

async function saveLogEntries(page: LogPage, entries: LiveLogEntry[]): Promise<void> {
  if (!LOG_STORE_ENABLED || entries.length === 0) return;

  const rows = entries.map((e) => ({
    entry_id: e.id,
    page,
    message: e.message.slice(0, 500),
    log_time: e.timestamp,
    event_at: eventTimeFromId(e.id),
  }));

  // Legacy anon keys are JWTs and may also be sent as a Bearer token.
  // The newer "publishable" keys are not JWTs and must go in `apikey` only.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY as string,
    Prefer: "return=minimal",
  };
  if ((SUPABASE_KEY as string).startsWith("eyJ")) {
    headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  }

  const post = (body: unknown[]) =>
    fetch(`${SUPABASE_URL}/rest/v1/robot_logs`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

  const warnOnce = (detail: string) => {
    if (warned) return;
    warned = true;
    console.warn(`[logStore] ${detail}`);
  };

  try {
    const res = await post(rows);
    if (res.ok) return;

    // 409 = at least one row already exists (another browser saved the
    // same backend event first). One duplicate fails the whole batch, so
    // retry row by row: new rows get saved, existing ones are skipped.
    if (res.status === 409) {
      if (rows.length > 1) {
        for (const row of rows) {
          const single = await post([row]);
          if (!single.ok && single.status !== 409) {
            warnOnce(`save failed (${single.status}) -- check the robot_logs table, its policy, and the Supabase env vars.`);
            return;
          }
        }
      }
      return;
    }

    warnOnce(`save failed (${res.status}) -- check the robot_logs table, its policy, and the Supabase env vars.`);
  } catch {
    warnOnce("could not reach the database; log lines are shown on screen but not saved.");
  }
}

/**
 * Call once per page with the entries that page shows in its log panel.
 * Each new entry is saved exactly once per browser tab.
 */
export function usePersistLog(page: LogPage, entries: LiveLogEntry[]): void {
  const savedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!LOG_STORE_ENABLED) return;
    const fresh = entries.filter((e) => !savedIds.current.has(e.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => savedIds.current.add(e.id));
    void saveLogEntries(page, fresh);
  }, [entries, page]);
}
