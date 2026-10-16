import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

/**
 * Background GPS task for drivers.
 *
 * Runs headless (no React, no Clerk session), so it authenticates with a
 * single-purpose upload token issued by POST /api/driver/upload-token when
 * the shift starts. The token and API origin are persisted to AsyncStorage
 * by the foreground app before background updates begin.
 */
export const LOCATION_TASK_NAME = 'bus-tracker-background-location';

const UPLOAD_TOKEN_KEY = 'bus-tracker-upload-token';
const API_URL_KEY = 'bus-tracker-api-url';

interface TaskData {
  locations?: Location.LocationObject[];
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const locations = (data as TaskData | null)?.locations;
  const latest = locations?.[0];
  if (!latest) return;

  try {
    const [token, apiUrl] = await Promise.all([
      AsyncStorage.getItem(UPLOAD_TOKEN_KEY),
      AsyncStorage.getItem(API_URL_KEY),
    ]);
    if (!token || !apiUrl) return;

    const { latitude, longitude, heading, speed, accuracy } = latest.coords;
    await fetch(`${apiUrl.replace(/\/+$/, '')}/api/driver/location`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Upload ${token}`,
      },
      body: JSON.stringify({ latitude, longitude, heading, speed, accuracy }),
    });
  } catch {
    // Next fix (10s) will retry; never crash the headless task.
  }
});

export async function startBackgroundSharing(options: {
  apiUrl: string;
  uploadToken: string;
}): Promise<void> {
  await AsyncStorage.multiSet([
    [UPLOAD_TOKEN_KEY, options.uploadToken],
    [API_URL_KEY, options.apiUrl],
  ]);
  const started = await Location.hasStartedLocationUpdatesAsync(
    LOCATION_TASK_NAME,
  ).catch(() => false);
  if (started) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10_000,
    distanceInterval: 20,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Sharing bus location',
      notificationBody: 'Your bus stays visible to students while you are on duty.',
    },
  });
}

export async function stopBackgroundSharing(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(
    LOCATION_TASK_NAME,
  ).catch(() => false);
  if (started) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(
      () => {},
    );
  }
  await AsyncStorage.multiRemove([UPLOAD_TOKEN_KEY, API_URL_KEY]).catch(
    () => {},
  );
}
