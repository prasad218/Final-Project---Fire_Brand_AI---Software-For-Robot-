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
//  - Duplicates are ignored by the database (unique entry_id): backend
//    log ids are stable ("log-<ms>-<seq>"), so two open browsers, or
//    both pages, saving the same backend event produce a single row.
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
    // ignore-duplicates = skip rows whose entry_id already exists
    Prefer: "resolution=ignore-duplicates,return=minimal",
  };
  if ((SUPABASE_KEY as string).startsWith("eyJ")) {
    headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/robot_logs?on_conflict=entry_id`, {
      method: "POST",
      headers,
      body: JSON.stringify(rows),
    });
    if (!res.ok && !warned) {
      warned = true;
      console.warn(`[logStore] save failed (${res.status}) -- check the robot_logs table, its policy, and the Supabase env vars.`);
    }
  } catch {
    if (!warned) {
      warned = true;
      console.warn("[logStore] could not reach the database; log lines are shown on screen but not saved.");
    }
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
