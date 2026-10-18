import type { Bus } from '@workspace/api-client-react';

/**
 * Route start / end layer shared by the student map and driver confirmations.
 *
 * The coordinates are optional bus fields set by the admin (startLat … endLon).
 * The named endpoints fall back to the first and last route stops.
 */
export interface RouteLayer {
  start: { latitude: number; longitude: number };
  end: { latitude: number; longitude: number };
  startName: string;
  endName: string;
}

export function getRouteLayer(bus: Bus | null | undefined): RouteLayer | null {
  if (
    !bus ||
    bus.startLat == null ||
    bus.startLon == null ||
    bus.endLat == null ||
    bus.endLon == null
  ) {
    return null;
  }
  const stops = bus.routeStops ?? [];
  const startName = stops.length > 0 ? stops[0] : 'Start';
  const endName = stops.length > 1 ? stops[stops.length - 1] : 'Destination';
  return {
    start: { latitude: bus.startLat, longitude: bus.startLon },
    end: { latitude: bus.endLat, longitude: bus.endLon },
    startName,
    endName,
  };
}

/** "Main Gate → Campus Gate" summary, or null when no route layer exists. */
export function routeSummary(bus: Bus | null | undefined): string | null {
  const layer = getRouteLayer(bus);
  return layer ? `${layer.startName} → ${layer.endName}` : null;
}

export interface TravelPoint {
  latitude: number;
  longitude: number;
}

/**
 * Bounding-box region that keeps the full route (and the live pin) in view.
 * Used as the initial camera of the native map.
 */
export function regionEnclosing(
  points: TravelPoint[],
  padScale = 1.9,
): {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
} {
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * padScale, 0.01),
    longitudeDelta: Math.max((maxLon - minLon) * padScale, 0.014),
  };
}
