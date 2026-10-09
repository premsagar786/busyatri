import * as Location from "expo-location";
import { setCurrentTrip, startTracking, stopTracking } from "./task";
import { saveSession, loadSession } from "../queue/db";

const TRIP_KEY = "busyatri_trip";

export function newTripId(busNumber: string): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `trip_${d}_${busNumber.replace(/\s+/g, "")}_${Date.now().toString(36)}`;
}

export async function beginTrip(busNumber: string): Promise<string> {
  const id = newTripId(busNumber);
  setCurrentTrip(id);
  await saveSession(TRIP_KEY, JSON.stringify({ tripId: id, busNumber, startedAt: new Date().toISOString() }));
  // Real GPS only — no simulation. Tracking uses the foreground service
  // so points keep flowing when the app is backgrounded.
  await startTracking(busNumber);
  return id;
}

export async function finishTrip(): Promise<void> {
  await stopTracking();
  setCurrentTrip(null);
  await saveSession(TRIP_KEY, "");
}

export async function resumeIfNeeded(): Promise<{ tripId: string; busNumber: string } | null> {
  const raw = await loadSession(TRIP_KEY);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { tripId: string; busNumber: string };
    if (!j.tripId) return null;
    return j;
  } catch {
    return null;
  }
}

export async function ensurePermissions(): Promise<{ fg: boolean; bg: boolean }> {
  const fg = await Location.requestForegroundPermissionsAsync();
  let bg = { granted: false } as { granted: boolean };
  if (fg.granted) {
    bg = await Location.requestBackgroundPermissionsAsync();
  }
  return { fg: fg.granted, bg: bg.granted };
}
