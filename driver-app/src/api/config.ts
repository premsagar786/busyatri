export const NET = {
  requestTimeoutMs: 10_000,
  batchSize: 50,
  gzipThresholdBytes: 1024,
  backoff: { baseMs: 2_000, capMs: 60_000, jitter: 0.3 },
  heartbeatTimeoutMs: 30_000,
  maxQueuedPoints: 10_000,
  uploadIntervalMs: 10_000,
  // How often the sync loop checks for fresh GPS points. 2 s keeps
  // phone→server latency near the GPS cadence; the query is a single
  // indexed SELECT and costs negligible battery.
  queuePollMs: 2_000,
};

export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
export const DEBUG = process.env.EXPO_PUBLIC_DEBUG === "true";
export const LOCATION_TASK = "busyatri-location-task";
