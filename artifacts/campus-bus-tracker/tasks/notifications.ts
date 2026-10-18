import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Local notifications for the driver's shift.
 *
 * When a driver taps "On duty", the app asks for notification permission
 * (once) and posts an immediate local notification confirming that their
 * location is going live. Ending a shift posts the reverse confirmation.
 *
 * Everything is best-effort: if permission is denied or the module is
 * unavailable (web / Expo Go quirks), the helpers resolve silently — the
 * in-app hero card and notice text still cover the same information.
 */

// Present local notifications as banners while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

async function post(title: string, body: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {
    // Notifications are a courtesy channel; never block the shift toggle.
  }
}

/** Fired right after the driver's shift goes live. */
export function notifyLocationLive(
  busNumber: string | null,
  routeSummary: string | null,
): Promise<void> {
  const bus = busNumber ? `Bus ${busNumber}` : 'Your bus';
  const route = routeSummary ? `${bus} · ${routeSummary}` : `${bus} · on the map`;
  return post(
    '📍 Your location is live',
    `Students can now track you in real time — ${route}.`,
  );
}

/** Fired when the driver ends the shift. */
export function notifyShiftEnded(): Promise<void> {
  return post(
    'Shift ended',
    'Location sharing paused — students no longer see your live position.',
  );
}
