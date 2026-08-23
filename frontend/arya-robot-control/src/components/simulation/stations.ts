import type { StationDefinition } from "../../types/robot";

// Repositioned to sit inside the actual lobby + corridor footprint (see
// ../../world/worldBounds.ts) so "Auto Navigate" drives ARYA to real,
// walkable points along the building instead of an abstract grid.
export const STATIONS: StationDefinition[] = [
  { id: "reception", name: "Reception", position: { x: 3.9, y: 0, z: 3.4 }, color: "#38d3ff" },
  { id: "room-101", name: "Room 101", position: { x: 0, y: 0, z: -3.6 }, color: "#34e3a1" },
  { id: "room-105", name: "Room 105", position: { x: 0, y: 0, z: -14.4 }, color: "#f0883e" },
  { id: "corridor-end", name: "Corridor End", position: { x: 0, y: 0, z: -39.8 }, color: "#a78bfa" },
];
