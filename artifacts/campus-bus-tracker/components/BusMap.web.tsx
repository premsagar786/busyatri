import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { Bus } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { getRouteLayer } from '@/utils/route';

const TILE_SIZE = 256;
const MIN_ZOOM = 13;
const MAX_ZOOM = 19;

/**
 * Projects lat/long into world pixel space for a given zoom level
 * (the same math OSM tiles use, so route points land on the mosaic).
 */
function projectIntoWorld(latitude: number, longitude: number, world: number) {
  const bounded = Math.max(-85.0511, Math.min(85.0511, latitude));
  const latitudeRadians = bounded * Math.PI / 180;
  return {
    x: ((longitude + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) * world,
  };
}

export default function BusMap({ bus }: { bus: Bus | null }) {
  const colors = useColors();
  const location = bus?.location;
  const route = getRouteLayer(bus);
  const { width: viewportWidth } = useWindowDimensions();
  const width = Math.min(580, Math.max(260, viewportWidth - 40));
  const height = 252;
  const [zoom, setZoom] = useState(16);

  const layout = useMemo(() => {
    if (!location) return null;
    const world = TILE_SIZE * 2 ** zoom;
    const busPixel = projectIntoWorld(location.latitude, location.longitude, world);
    const centerX = Math.floor(busPixel.x / TILE_SIZE);
    const centerY = Math.floor(busPixel.y / TILE_SIZE);
    const offsetX = width / 2 - (busPixel.x - centerX * TILE_SIZE);
    const offsetY = height / 2 - (busPixel.y - centerY * TILE_SIZE);
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
  }, [location?.latitude, location?.longitude, width, height, zoom]);

  if (!bus || !location || !layout) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
        {bus ? (
          <View style={[styles.busIcon, { backgroundColor: colors.primary }]}><Ionicons name="bus" size={22} color={colors.primaryForeground} /></View>
        ) : <Ionicons name="map-outline" size={30} color={colors.primary} />}
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{bus ? `Bus ${bus.busNumber} is on this route` : 'Select a campus bus'}</Text>
        <Text style={[styles.smallText, { color: colors.mutedForeground }]}>
          {bus
            ? 'The map shows your route start → end while the driver is live.'
            : 'Its latest phone GPS location will appear here.'}
        </Text>
      </View>
    );
  }

  const busOnScreen = layout.onScreen(location.latitude, location.longitude);
  const startOnScreen = route ? layout.onScreen(route.start.latitude, route.start.longitude) : null;
  const endOnScreen = route ? layout.onScreen(route.end.latitude, route.end.longitude) : null;
  const coveredPoints = route && startOnScreen
    ? [startOnScreen, { x: busOnScreen.x, y: busOnScreen.y }].map((p) => `${p.x},${p.y}`).join(' ')
    : '';
  const remainingPoints = route && endOnScreen
    ? [{ x: busOnScreen.x, y: busOnScreen.y }, endOnScreen].map((p) => `${p.x},${p.y}`).join(' ')
    : '';

  return (
    <View style={[styles.frame, { width, borderColor: colors.border }]}>
      {layout.tiles.map((tile) => (
        <Image key={tile.key} source={{ uri: tile.uri }} resizeMode="stretch" style={[styles.tile, { left: tile.left, top: tile.top }]} />
      ))}
      {route && startOnScreen && endOnScreen && (
        <Svg style={styles.routeLayer} pointerEvents="none">
          <Polyline points={coveredPoints} fill="none" stroke={colors.primary} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.9} />
          <Polyline points={remainingPoints} fill="none" stroke={colors.primary} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.9} strokeDasharray="8 7" />
        </Svg>
      )}
      {route && startOnScreen && (
        <View style={[styles.endpoint, { left: startOnScreen.x - 13, top: startOnScreen.y - 13, backgroundColor: colors.accent, borderColor: colors.accentForeground }]} pointerEvents="none">
          <Ionicons name="play" size={11} color={colors.accentForeground} />
        </View>
      )}
      {route && endOnScreen && (
        <View style={[styles.endpoint, { left: endOnScreen.x - 13, top: endOnScreen.y - 13, backgroundColor: colors.primary, borderColor: colors.accent }]} pointerEvents="none">
          <Ionicons name="flag" size={11} color={colors.primaryForeground} />
        </View>
      )}
      <View style={[styles.centerPin, { marginLeft: -17, marginTop: -17 }]} pointerEvents="none">
        <View style={[route ? styles.markerSmall : styles.marker, { backgroundColor: colors.primary, borderColor: colors.accent }]}>
          <Ionicons name="bus" size={route ? 15 : 20} color={colors.primaryForeground} />
        </View>
      </View>
      {/* zoom controls */}
      <View style={[styles.zoomControls, { top: 52 }]}>
        <Pressable
          accessibilityLabel="Zoom in"
          onPress={() => setZoom((value) => Math.min(MAX_ZOOM, value + 1))}
          disabled={zoom >= MAX_ZOOM}
          style={({ pressed }) => [
            styles.zoomButton,
            { backgroundColor: colors.card, borderColor: colors.border },
            zoom >= MAX_ZOOM && styles.zoomDisabled,
            pressed && styles.zoomPressed,
          ]}
        >
          <Ionicons name="add" size={17} color={zoom >= MAX_ZOOM ? colors.mutedForeground : colors.primary} />
        </Pressable>
        <Pressable
          accessibilityLabel="Zoom out"
          onPress={() => setZoom((value) => Math.max(MIN_ZOOM, value - 1))}
          disabled={zoom <= MIN_ZOOM}
          style={({ pressed }) => [
            styles.zoomButton,
            { backgroundColor: colors.card, borderColor: colors.border },
            zoom <= MIN_ZOOM && styles.zoomDisabled,
            pressed && styles.zoomPressed,
          ]}
        >
          <Ionicons name="remove" size={17} color={zoom <= MIN_ZOOM ? colors.mutedForeground : colors.primary} />
        </Pressable>
      </View>
      <View style={[styles.attribution, { backgroundColor: colors.card }]}>
        <Text style={[styles.attributionText, { color: colors.mutedForeground }]}>© OpenStreetMap</Text>
      </View>
      <View style={styles.labels}>
        <View style={[styles.label, { backgroundColor: colors.card }]}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.labelText, { color: colors.foreground }]}>Bus {bus.busNumber}</Text>
        </View>
        {route && (
          <View style={[styles.routeLegend, { backgroundColor: colors.card }]}>
            <Ionicons name="navigate" size={11} color={colors.primary} />
            <Text style={[styles.routeLegendText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {route.startName} → {route.endName}
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
  endpoint: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  zoomControls: { position: 'absolute', right: 11, gap: 7, zIndex: 10 },
  zoomButton: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  zoomDisabled: { opacity: 0.45 },
  zoomPressed: { transform: [{ scale: 0.94 }], opacity: 0.85 },
  empty: { height: 220, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 9, marginBottom: 15 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  busIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  marker: { width: 43, height: 43, borderRadius: 16, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  markerSmall: { width: 34, height: 34, borderRadius: 12, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  attribution: { position: 'absolute', bottom: 6, left: 7, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3 },
  attributionText: { fontSize: 9 },
  labels: { position: 'absolute', top: 11, left: 11, right: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  label: { borderRadius: 11, paddingVertical: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  labelText: { fontSize: 12, fontWeight: '800' },
  routeLegend: { borderRadius: 11, paddingVertical: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  routeLegendText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  smallText: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
