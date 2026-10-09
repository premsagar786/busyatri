import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { LOCATION_TASK } from "../api/config";
import { enqueue, bumpSeq } from "../queue/db";

// UUID v4 without deps
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let currentTripId: string | null = null;
export function setCurrentTrip(id: string | null) {
  currentTripId = id;
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("[task] location error", error);
    return;
  }
  if (!currentTripId) return;
  const { locations } = data as unknown as { locations: Location.LocationObject[] };
  for (const loc of locations || []) {
    const seq = await bumpSeq();
    await enqueue(currentTripId, {
      point_id: uuid(),
      seq,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy_m: loc.coords.accuracy ?? undefined,
      speed_mps: loc.coords.speed ?? undefined,
      recorded_at: new Date(loc.timestamp).toISOString(),
    });
  }
});

export async function startTracking(busNumber: string) {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 10_000,
    distanceInterval: 0,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "BusYatri: Trip active",
      notificationBody: `Bus ${busNumber} is sending location`,
    },
  });
}

export async function stopTracking() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch (err) {
    console.error("[tracking] stop failed", err);
  }
}

export { uuid };
