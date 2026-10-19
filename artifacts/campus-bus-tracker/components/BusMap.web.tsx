import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { Bus, RouteMapResponse, RouteStopPoint } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { getRouteLayer } from '@/utils/route';

const TILE_SIZE = 256;
const MIN_ZOOM = 10;
const MAX_ZOOM = 19;
const MAP_LAT_MAX = 85.0511;

/**
 * Projects lat/long into world pixel space for a given zoom level
 * (the same math OSM tiles use, so route points land on the mosaic).
 */
function projectIntoWorld(latitude: number, longitude: number, world: number) {
  const bounded = Math.max(-MAP_LAT_MAX, Math.min(MAP_LAT_MAX, latitude));
  const latitudeRadians = (bounded * Math.PI) / 180;
  return {
    x: ((longitude + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) * world,
  };
}

/** Inverse mercator: world pixel -> lat/long (used after the map is dragged). */
function unprojectInto(x: number, y: number, world: number) {
  const longitude = (x / world) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / world;
  return { latitude: (Math.atan(Math.sinh(n)) * 180) / Math.PI, longitude };
}

type GeoCenter = { latitude: number; longitude: number };

function clampCenter(center: GeoCenter): GeoCenter {
  return {
    latitude: Math.max(-MAP_LAT_MAX, Math.min(MAP_LAT_MAX, center.latitude)),
    longitude: Math.max(-179.99, Math.min(179.99, center.longitude)),
  };
}

/** Highest zoom level whose world-size still fits the given polyline in the frame. */
function fitZoomFor(geometry: number[][], frameWidth: number, frameHeight: number) {
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const world = TILE_SIZE * 2 ** zoom;
    const points = geometry.map(([latitude, longitude]) => projectIntoWorld(latitude, longitude, world));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const spanX = Math.max(...xs) - Math.min(...xs) + 160;
    const spanY = Math.max(...ys) - Math.min(...ys) + 160;
    if (spanX <= frameWidth && spanY <= frameHeight) return zoom;
  }
  return MIN_ZOOM;
}

type DragStart = { anchor: GeoCenter; world: number; pageX: number; pageY: number };

export default function BusMap({ bus, routeMap }: { bus: Bus | null; routeMap?: RouteMapResponse | null }) {
  const colors = useColors();
  const location = bus?.location;
  const legacyRoute = getRouteLayer(bus);
  const { width: viewportWidth } = useWindowDimensions();
  const width = Math.min(580, Math.max(260, viewportWidth - 40));
  const height = 252;
  const [zoom, setZoom] = useState(16);
  const [viewMode, setViewMode] = useState<'follow' | 'route'>('follow');
  /** Where the map looks after the student drags away from the bus/route. */
  const [manualCenter, setManualCenter] = useState<GeoCenter | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  /* --- Stop flags from the API's geocoded chain (falls back to the plain start/end layer). --- */
  const mappedStops: RouteStopPoint[] = (routeMap?.stops ?? []).filter(
    (stop) => stop.latitude != null && stop.longitude != null,
  );
  const roadGeometry = routeMap && routeMap.geometry.length >= 2 ? routeMap.geometry : null;
  const geometryKey = roadGeometry
    ? `${roadGeometry.length}:${roadGeometry[0][0]},${roadGeometry[roadGeometry.length - 1][1]}`
    : 'none';

  const routeCenter = useMemo<GeoCenter | null>(() => {
    if (!roadGeometry) return null;
    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;
    for (const [latitude, longitude] of roadGeometry) {
      minLat = Math.min(minLat, latitude);
      maxLat = Math.max(maxLat, latitude);
      minLon = Math.min(minLon, longitude);
      maxLon = Math.max(maxLon, longitude);
    }
    return { latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2 };
    // geometryKey stands in for route contents so a refreshed route re-frames once.
  }, [geometryKey]);

  const baseCenter: GeoCenter | null = !location
    ? null
    : viewMode === 'route' && routeCenter
      ? routeCenter
      : { latitude: location.latitude, longitude: location.longitude };
  const effectiveCenter = manualCenter ?? baseCenter;

  const effectiveCenterRef = useRef<GeoCenter | null>(effectiveCenter);
  effectiveCenterRef.current = effectiveCenter;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const layout = useMemo(() => {
    if (!effectiveCenter) return null;
    const world = TILE_SIZE * 2 ** zoom;
    const center = projectIntoWorld(effectiveCenter.latitude, effectiveCenter.longitude, world);
    const centerX = Math.floor(center.x / TILE_SIZE);
    const centerY = Math.floor(center.y / TILE_SIZE);
    const offsetX = width / 2 - (center.x - centerX * TILE_SIZE);
    const offsetY = height / 2 - (center.y - centerY * TILE_SIZE);
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = ((centerX + dx) % 2 ** zoom + 2 ** zoom) % 2 ** zoom;
        const y = centerY + dy;
        if (y < 0 || y >= 2 ** zoom) continue;
        tiles.push({
          key: `${zoom}-${x}-${y}`,
          uri: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
          left: offsetX + dx * TILE_SIZE,
          top: offsetY + dy * TILE_SIZE,
        });
      }
    }
    const onScreen = (latitude: number, longitude: number) => {
      const pixel = projectIntoWorld(latitude, longitude, world);
      return { x: pixel.x - centerX * TILE_SIZE + offsetX, y: pixel.y - centerY * TILE_SIZE + offsetY };
    };
    return { tiles, onScreen };
  }, [effectiveCenter?.latitude, effectiveCenter?.longitude, zoom, width, height]);

  /* Pan + pinch: mouse, pen and touch all re-anchor the map. Taps short of the
     drag threshold still reach the buttons, so +/− never loses its click. */
  const dragStartRef = useRef<DragStart | null>(null);
  const pinchBaseRef = useRef<{ dist: number; zoom: number } | null>(null);
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dx) + Math.abs(gestureState.dy) > 6 || gestureState.numberActiveTouches > 1,
        onPanResponderGrant: (event) => {
          const anchor = effectiveCenterRef.current;
          if (!anchor) return;
          dragStartRef.current = {
            anchor,
            world: TILE_SIZE * 2 ** zoomRef.current,
            pageX: event.nativeEvent.pageX,
            pageY: event.nativeEvent.pageY,
          };
          pinchBaseRef.current = null;
          setIsDragging(true);
        },
        onPanResponderMove: (event) => {
          const start = dragStartRef.current;
          if (!start) return;
          const touches = (event.nativeEvent.touches ?? []) as Array<{ pageX: number; pageY: number }>;
          if (touches.length >= 2) {
            // Pinch: scale between the two fingers turns into zoom steps.
            const dist = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
            const base = pinchBaseRef.current ?? (pinchBaseRef.current = { dist, zoom: zoomRef.current });
            if (base.dist > 0) {
              const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base.zoom + Math.round(Math.log2(dist / base.dist))));
              if (next !== zoomRef.current) setZoom(next);
            }
            return;
          }
          pinchBaseRef.current = null;
          const deltaX = event.nativeEvent.pageX - start.pageX;
          const deltaY = event.nativeEvent.pageY - start.pageY;
          if (!deltaX && !deltaY) return;
          const anchorPixel = projectIntoWorld(start.anchor.latitude, start.anchor.longitude, start.world);
          setManualCenter(
            clampCenter(unprojectInto(anchorPixel.x - deltaX, anchorPixel.y - deltaY, start.world)),
          );
        },
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: () => {
          dragStartRef.current = null;
          setIsDragging(false);
        },
        onPanResponderTerminate: () => {
          dragStartRef.current = null;
          setIsDragging(false);
        },
      }),
    [],
  );

  /* Mouse wheel zoom (throttled so a single trackpad flick doesn't rip through levels). */
  const lastWheelRef = useRef(0);
  const wheelProps: Record<string, unknown> = Platform.OS === 'web'
    ? {
        onWheel: (event: unknown) => {
          const native = (event as { nativeEvent?: { deltaY?: number; wheelDelta?: number } })?.nativeEvent ?? {};
          const deltaY = native.deltaY ?? native.wheelDelta ?? 0;
          if (!deltaY) return;
          const now = Date.now();
          if (now - lastWheelRef.current < 140) return;
          lastWheelRef.current = now;
          setZoom((value) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value + (deltaY < 0 ? 1 : -1))));
        },
      }
    : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extraFrameProps: any = Platform.OS === 'web' ? wheelProps : {};
  // The map surface owns touch gestures so pinch/drag pan the map, not the page.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extraFrameStyle: any = Platform.OS === 'web' ? { touchAction: 'none' } : {};

  if (!bus || !location || !layout) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
        {bus ? (
          <View style={[styles.busIcon, { backgroundColor: colors.primary }]}><Ionicons name="bus" size={22} color={colors.primaryForeground} /></View>
        ) : <Ionicons name="map-outline" size={30} color={colors.primary} />}
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{bus ? `Bus ${bus.busNumber} is on this route` : 'Select a campus bus'}</Text>
        <Text style={[styles.smallText, { color: colors.mutedForeground }]}>
          {bus
            ? 'Drag, scroll or use +/− to explore the map.'
            : 'Its latest phone GPS location will appear here.'}
        </Text>
      </View>
    );
  }

  const busOnScreen = layout.onScreen(location.latitude, location.longitude);
  const startName = mappedStops.length ? mappedStops[0].name : legacyRoute?.startName;
  const endName = mappedStops.length ? mappedStops[mappedStops.length - 1].name : legacyRoute?.endName;
  const hasRoute = Boolean(roadGeometry || mappedStops.length >= 2 || legacyRoute);

  const startOnScreen = mappedStops.length
    ? layout.onScreen(mappedStops[0].latitude as number, mappedStops[0].longitude as number)
    : legacyRoute
      ? layout.onScreen(legacyRoute.start.latitude, legacyRoute.start.longitude)
      : null;
  const endOnScreen = mappedStops.length
    ? layout.onScreen(mappedStops[mappedStops.length - 1].latitude as number, mappedStops[mappedStops.length - 1].longitude as number)
    : legacyRoute
      ? layout.onScreen(legacyRoute.end.latitude, legacyRoute.end.longitude)
      : null;

  /* --- The two road polylines: covered (solid) to the live bus, remaining (dashed). --- */
  let coveredPoints = '';
  let remainingPoints = '';
  if (roadGeometry) {
    const vertices = roadGeometry.map(([latitude, longitude]) => layout.onScreen(latitude, longitude));
    let nearest = 0;
    let nearestDistance = Infinity;
    vertices.forEach((point, index) => {
      const distance = (point.x - busOnScreen.x) ** 2 + (point.y - busOnScreen.y) ** 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    });
    coveredPoints = [...vertices.slice(0, nearest + 1), busOnScreen].map((point) => `${point.x},${point.y}`).join(' ');
    remainingPoints = [busOnScreen, ...vertices.slice(nearest + 1)].map((point) => `${point.x},${point.y}`).join(' ');
  } else if (startOnScreen && endOnScreen) {
    coveredPoints = [startOnScreen, busOnScreen].map((point) => `${point.x},${point.y}`).join(' ');
    remainingPoints = [busOnScreen, endOnScreen].map((point) => `${point.x},${point.y}`).join(' ');
  }

  const destinationEta = routeMap?.destinationEtaMin ?? null;
  const destinationDistance = routeMap?.destinationDistanceKm ?? null;
  const approximate = routeMap?.source === 'estimate';

  return (
    <View
      style={[styles.frame, extraFrameStyle, { width, borderColor: isDragging ? colors.primary : colors.border }]}
      {...gesture.panHandlers}
      {...extraFrameProps}
    >
      {layout.tiles.map((tile) => (
        <Image key={tile.key} source={{ uri: tile.uri }} resizeMode="stretch" style={[styles.tile, { left: tile.left, top: tile.top }]} />
      ))}
      <Svg style={styles.routeLayer} pointerEvents="none">
        <Polyline points={coveredPoints} fill="none" stroke={colors.primary} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.9} />
        <Polyline points={remainingPoints} fill="none" stroke={colors.primary} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.9} strokeDasharray={roadGeometry ? '10 9' : '8 7'} />
      </Svg>

      {/* Intermediate stop flags (geocoded by the API) */}
      {mappedStops.length > 2 && mappedStops.slice(1, -1).map((stop, index) => {
        if (stop.latitude == null || stop.longitude == null) return null;
        const point = layout.onScreen(stop.latitude, stop.longitude);
        return (
          <View
            key={`flag-${stop.name}-${index}`}
            style={[styles.stopFlagDot, { left: point.x - 11, top: point.y - 11, backgroundColor: stop.reached ? colors.primary : colors.card, borderColor: colors.border }]}
            pointerEvents="none"
          >
            <Ionicons name={stop.reached ? 'checkmark' : 'flag'} size={10} color={stop.reached ? colors.primaryForeground : colors.primary} />
          </View>
        );
      })}

      {startOnScreen && hasRoute && (
        <View style={[styles.endpoint, { left: startOnScreen.x - 13, top: startOnScreen.y - 13, backgroundColor: colors.accent, borderColor: colors.accentForeground }]} pointerEvents="none">
          <Ionicons name="play" size={11} color={colors.accentForeground} />
        </View>
      )}
      {endOnScreen && hasRoute && (
        <View style={[styles.endpoint, { left: endOnScreen.x - 13, top: endOnScreen.y - 13, backgroundColor: colors.primary, borderColor: colors.accent }]} pointerEvents="none">
          <Ionicons name="flag" size={11} color={colors.primaryForeground} />
        </View>
      )}
      <View style={[styles.centerPin, { marginLeft: -17, marginTop: -17 }]} pointerEvents="none">
        <View style={[hasRoute ? styles.markerSmall : styles.marker, { backgroundColor: colors.primary, borderColor: colors.accent }]}>
          <Ionicons name="bus" size={hasRoute ? 15 : 20} color={colors.primaryForeground} />
        </View>
      </View>

      {/* zoom + view controls */}
      <View style={styles.controls}>
        <Pressable
          accessibilityLabel="Zoom in"
          onPress={() => setZoom((value) => Math.min(MAX_ZOOM, value + 1))}
          disabled={zoom >= MAX_ZOOM}
          style={({ pressed }) => [
            styles.controlButton,
            { backgroundColor: colors.card, borderColor: colors.border },
            zoom >= MAX_ZOOM && styles.controlDisabled,
            pressed && styles.controlPressed,
          ]}
        >
          <Ionicons name="add" size={19} color={zoom >= MAX_ZOOM ? colors.mutedForeground : colors.primary} />
        </Pressable>
        <Pressable
          accessibilityLabel="Zoom out"
          onPress={() => setZoom((value) => Math.max(MIN_ZOOM, value - 1))}
          disabled={zoom <= MIN_ZOOM}
          style={({ pressed }) => [
            styles.controlButton,
            { backgroundColor: colors.card, borderColor: colors.border },
            zoom <= MIN_ZOOM && styles.controlDisabled,
            pressed && styles.controlPressed,
          ]}
        >
          <Ionicons name="remove" size={19} color={zoom <= MIN_ZOOM ? colors.mutedForeground : colors.primary} />
        </Pressable>
        {roadGeometry && (
          <Pressable
            accessibilityLabel={viewMode === 'follow' ? 'Show whole route' : 'Follow the bus'}
            onPress={() => {
              if (viewMode === 'follow') {
                setZoom(fitZoomFor(roadGeometry, width, height));
                setViewMode('route');
                setManualCenter(null);
              } else {
                setZoom(16);
                setViewMode('follow');
                setManualCenter(null);
              }
            }}
            style={({ pressed }) => [
              styles.controlButton,
              { backgroundColor: viewMode === 'route' ? colors.primary : colors.card, borderColor: colors.border },
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons name={viewMode === 'follow' ? 'git-compare-outline' : 'bus'} size={16} color={viewMode === 'follow' ? colors.primary : colors.primaryForeground} />
          </Pressable>
        )}
        {manualCenter && (
          <Pressable
            accessibilityLabel="Centre on bus"
            onPress={() => setManualCenter(null)}
            style={({ pressed }) => [
              styles.controlButton,
              { backgroundColor: colors.accent, borderColor: colors.border },
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons name="locate" size={16} color={colors.accentForeground} />
          </Pressable>
        )}
      </View>
      <View style={[styles.attribution, { backgroundColor: colors.card }]}>
        <Text style={[styles.attributionText, { color: colors.mutedForeground }]}>© OpenStreetMap</Text>
      </View>
      <View style={[styles.hintChip, { backgroundColor: colors.card }]}>
        <Text style={[styles.attributionText, { color: colors.mutedForeground }]}>Drag to pan · scroll to zoom</Text>
      </View>
      <View style={styles.labels} pointerEvents="box-none">
        <View style={[styles.label, { backgroundColor: colors.card }]}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.labelText, { color: colors.foreground }]}>Bus {bus.busNumber}</Text>
        </View>
        {hasRoute && startName && endName && (
          <View style={[styles.routeLegend, { backgroundColor: colors.card }]}>
            <Ionicons name="navigate" size={11} color={colors.primary} />
            <Text style={[styles.routeLegendText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {startName} → {endName}
            </Text>
          </View>
        )}
        {destinationEta != null && (
          <View style={[styles.etaChip, { backgroundColor: colors.card, marginLeft: 'auto' }]}>
            <Ionicons name="flag" size={11} color={colors.primary} />
            <Text style={[styles.routeLegendText, { color: colors.foreground }]} numberOfLines={1}>
              {approximate ? '≈ ' : ''}ETA {Math.round(destinationEta)} min{destinationDistance != null ? ` · ${destinationDistance} km` : ''}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 252, maxWidth: '100%', borderRadius: 22, overflow: 'hidden', borderWidth: 1, marginBottom: 15, alignSelf: 'center', backgroundColor: '#e7ece7' },
  tile: { position: 'absolute', width: TILE_SIZE, height: TILE_SIZE },
  routeLayer: { position: 'absolute', width: '100%', height: '100%' },
  centerPin: { position: 'absolute', left: '50%', top: '50%' },
  endpoint: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  stopFlagDot: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  controls: { position: 'absolute', right: 11, top: 48, gap: 7, zIndex: 10, alignItems: 'center' },
  controlButton: { width: 38, height: 38, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  controlDisabled: { opacity: 0.45 },
  controlPressed: { transform: [{ scale: 0.94 }], opacity: 0.85 },
  empty: { height: 220, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 9, marginBottom: 15 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  busIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  marker: { width: 43, height: 43, borderRadius: 16, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  markerSmall: { width: 34, height: 34, borderRadius: 12, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  attribution: { position: 'absolute', bottom: 6, left: 7, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3, zIndex: 5 },
  attributionText: { fontSize: 9 },
  hintChip: { position: 'absolute', bottom: 6, left: 105, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, zIndex: 5 },
  labels: { position: 'absolute', top: 11, left: 11, right: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, zIndex: 5 },
  label: { borderRadius: 11, paddingVertical: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  labelText: { fontSize: 12, fontWeight: '800' },
  routeLegend: { borderRadius: 11, paddingVertical: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  routeLegendText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  etaChip: { borderRadius: 11, paddingVertical: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  smallText: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
