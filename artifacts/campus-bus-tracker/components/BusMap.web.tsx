import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { Bus } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

const TILE_SIZE = 256;
const ZOOM = 16;
const WORLD = TILE_SIZE * 2 ** ZOOM;

export default function BusMap({ bus }: { bus: Bus | null }) {
  const colors = useColors();
  const location = bus?.location;
  const { width: viewportWidth } = useWindowDimensions();
  const width = Math.min(580, Math.max(260, viewportWidth - 40));
  const height = 252;

  const tilePositions = useMemo(() => {
    if (!location) return [];
    const latitude = Math.max(-85.0511, Math.min(85.0511, location.latitude));
    const latitudeRadians = latitude * Math.PI / 180;
    const pixelX = ((location.longitude + 180) / 360) * WORLD;
    const pixelY = ((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) * WORLD;
    const centerX = Math.floor(pixelX / TILE_SIZE);
    const centerY = Math.floor(pixelY / TILE_SIZE);
    const offsetX = width / 2 - (pixelX - centerX * TILE_SIZE);
    const offsetY = height / 2 - (pixelY - centerY * TILE_SIZE);
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = ((centerX + dx) % 2 ** ZOOM + 2 ** ZOOM) % 2 ** ZOOM;
        const y = centerY + dy;
        if (y < 0 || y >= 2 ** ZOOM) continue;
        tiles.push({
          key: `${x}-${y}`,
          uri: `https://tile.openstreetmap.org/${ZOOM}/${x}/${y}.png`,
          left: offsetX + dx * TILE_SIZE,
          top: offsetY + dy * TILE_SIZE,
        });
      }
    }
    return tiles;
  }, [location?.latitude, location?.longitude, width, height]);

  if (!bus || !location) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
        {bus ? (
          <View style={[styles.busIcon, { backgroundColor: colors.primary }]}><Ionicons name="bus" size={22} color={colors.primaryForeground} /></View>
        ) : <Ionicons name="map-outline" size={30} color={colors.primary} />}
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{bus ? `Bus ${bus.busNumber} is on this route` : 'Select a campus bus'}</Text>
        <Text style={[styles.smallText, { color: colors.mutedForeground }]}>
          {bus ? 'The map updates when the driver starts a shift and shares GPS.' : 'Its latest phone GPS location will appear here.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.frame, { width, borderColor: colors.border }]}>
      {tilePositions.map((tile) => (
        <Image key={tile.key} source={{ uri: tile.uri }} resizeMode="stretch" style={[styles.tile, { left: tile.left, top: tile.top }]} />
      ))}
      <View style={styles.centerPin}>
        <View style={[styles.marker, { backgroundColor: colors.primary, borderColor: colors.accent }]}>
          <Ionicons name="bus" size={20} color={colors.primaryForeground} />
        </View>
      </View>
      <View style={[styles.attribution, { backgroundColor: colors.card }]}>
        <Text style={[styles.attributionText, { color: colors.mutedForeground }]}>© OpenStreetMap</Text>
      </View>
      <View style={[styles.label, { backgroundColor: colors.card }]}>
        <View style={[styles.dot, { backgroundColor: colors.primary }]} />
        <Text style={[styles.labelText, { color: colors.foreground }]}>Bus {bus.busNumber}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 252, maxWidth: '100%', borderRadius: 22, overflow: 'hidden', borderWidth: 1, marginBottom: 15, alignSelf: 'center', backgroundColor: '#e7ece7' },
  tile: { position: 'absolute', width: TILE_SIZE, height: TILE_SIZE },
  centerPin: { position: 'absolute', left: '50%', top: '50%', marginLeft: -22, marginTop: -22 },
  empty: { height: 220, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 9, marginBottom: 15 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  busIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  marker: { width: 43, height: 43, borderRadius: 16, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  attribution: { position: 'absolute', bottom: 6, left: 7, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3 },
  attributionText: { fontSize: 9 },
  label: { position: 'absolute', top: 11, left: 11, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  labelText: { fontSize: 12, fontWeight: '800' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  smallText: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
