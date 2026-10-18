import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { Bus, RouteMapResponse } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { getRouteLayer, regionEnclosing } from '@/utils/route';

// The OSRM flags/road layer is web-only for now (react-native-maps already has
// gestures); the prop is accepted so the shared student dashboard call site
// typechecks on both platforms.
export default function BusMap({ bus, routeMap: _routeMap }: { bus: Bus | null; routeMap?: RouteMapResponse | null }) {
  const colors = useColors();
  const location = bus?.location;
  const route = getRouteLayer(bus);

  if (!bus || !location) {
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

  // Frame the whole trip when a route layer exists; otherwise center the bus.
  const travelPoints = route
    ? [route.start, route.end, { latitude: location.latitude, longitude: location.longitude }]
    : [{ latitude: location.latitude, longitude: location.longitude }];

  return (
    <View style={[styles.frame, { borderColor: colors.border }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={
          route
            ? regionEnclosing(travelPoints)
            : { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }
        }
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
        showsCompass
        toolbarEnabled={false}
        accessibilityLabel={`Map showing bus ${bus.busNumber}`}
      >
        <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} tileSize={256} />
        {route && (
          <Polyline
            coordinates={[route.start, { latitude: location.latitude, longitude: location.longitude }]}
            strokeColor={colors.primary}
            strokeWidth={4}
          />
        )}
        {route && (
          <Polyline
            coordinates={[{ latitude: location.latitude, longitude: location.longitude }, route.end]}
            strokeColor={colors.primary}
            strokeWidth={4}
            lineDashPattern={[10, 8]}
          />
        )}
        {route && (
          <Marker coordinate={route.start} title={`Start · ${route.startName}`} description="Route begins here" tracksViewChanges={false}>
            <View style={[styles.endpoint, { backgroundColor: colors.accent, borderColor: colors.accentForeground }]}>
              <Ionicons name="play" size={13} color={colors.accentForeground} />
            </View>
          </Marker>
        )}
        {route && (
          <Marker coordinate={route.end} title={`Destination · ${route.endName}`} description="Route ends here" tracksViewChanges={false}>
            <View style={[styles.endpoint, { backgroundColor: colors.primary, borderColor: colors.accent }]}>
              <Ionicons name="flag" size={13} color={colors.primaryForeground} />
            </View>
          </Marker>
        )}
        <Marker
          coordinate={{ latitude: location.latitude, longitude: location.longitude }}
          title={`Bus ${bus.busNumber}`}
          description={bus.routeName}
          tracksViewChanges={false}
        >
          <View style={[route ? styles.markerSmall : styles.marker, { backgroundColor: colors.primary, borderColor: colors.accent }]}>
            <Ionicons name="bus" size={route ? 15 : 20} color={colors.primaryForeground} />
          </View>
        </Marker>
      </MapView>
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
  frame: { height: 252, borderRadius: 22, overflow: 'hidden', borderWidth: 1, marginBottom: 15 },
  empty: { height: 220, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 9, marginBottom: 15 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  busIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  marker: { width: 43, height: 43, borderRadius: 16, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  markerSmall: { width: 34, height: 34, borderRadius: 12, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  endpoint: { width: 27, height: 27, borderRadius: 14, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
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
