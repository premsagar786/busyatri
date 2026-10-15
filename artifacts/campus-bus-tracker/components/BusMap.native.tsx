import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { Bus } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export default function BusMap({ bus }: { bus: Bus | null }) {
  const colors = useColors();
  const location = bus?.location;

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

  const region = {
    latitude: location.latitude,
    longitude: location.longitude,
    latitudeDelta: 0.012,
    longitudeDelta: 0.012,
  };

  return (
    <View style={[styles.frame, { borderColor: colors.border }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        region={region}
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
        showsCompass
        toolbarEnabled={false}
        accessibilityLabel={`Map showing bus ${bus.busNumber}`}
      >
        <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} tileSize={256} />
        <Marker
          coordinate={{ latitude: location.latitude, longitude: location.longitude }}
          title={`Bus ${bus.busNumber}`}
          description={bus.routeName}
          tracksViewChanges={false}
        >
          <View style={[styles.marker, { backgroundColor: colors.primary, borderColor: colors.accent }]}>
            <Ionicons name="bus" size={20} color={colors.primaryForeground} />
          </View>
        </Marker>
      </MapView>
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
  frame: { height: 252, borderRadius: 22, overflow: 'hidden', borderWidth: 1, marginBottom: 15 },
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
