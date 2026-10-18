import { useClerk, useAuth } from '@clerk/expo';
import {
  customFetch,
  useClearBusLocation,
  useCreateBus,
  useCreateDriver,
  useCreateDriverRemark,
  useDeleteBus,
  useDeleteDriver,
  useGetAdminOverview,
  useGetCampus,
  useGetMe,
  useGetRouteMap,
  getGetRouteMapQueryKey,
  useListAdminBuses,
  useListDrivers,
  useUpdateBus,
  useUpdateDriver,
  useUpdateDriverLocation,
  useUpdateDriverShift,
  useSetAdminBusLocation,
  getGetAdminOverviewQueryKey,
  getGetCampusQueryKey,
  getGetMeQueryKey,
  getListAdminBusesQueryKey,
  getListDriversQueryKey,
  type Bus,
  type Driver,
  type Profile,
  type RouteMapResponse,
} from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import {
  startBackgroundSharing,
  stopBackgroundSharing,
} from '@/tasks/locationTask';
import { useRouter } from 'expo-router';
import BusMap from '@/components/BusMap';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useTheme, type ThemeMode } from '@/hooks/ThemeContext';
import { notifyLocationLive, notifyShiftEnded } from '@/tasks/notifications';
import { routeSummary } from '@/utils/route';
import Constants from 'expo-constants';

type Section = 'overview' | 'buses' | 'drivers';

const PARKING_SPOTS = [
  'Main Gate',
  'Law College',
  'AGC Park',
  'Clerk Office',
  'Canteen',
  'Girls Hostel',
  'Ground',
];

/** Parses "lat, lon" text input → coordinates (invalid/empty = null). */
function parseCoordPair(input: string): { latitude: number; longitude: number } | null {
  const parts = input.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

/**
 * "" → undefined (leave the saved route untouched), else the parsed pair or
 * null when the text is filled but not a valid "lat, lon" pair.
 */
function parseCoordsField(input: string): { latitude: number; longitude: number } | null | undefined {
  if (!input.trim()) return undefined;
  return parseCoordPair(input.trim());
}

export default function CampusApp() {
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  const profileQuery = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: !!isSignedIn, retry: false },
  });
  const campusQuery = useGetCampus({
    query: { queryKey: getGetCampusQueryKey(), enabled: !!isSignedIn, refetchInterval: 5000 },
  });

  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <WelcomeScreen />;
  if (profileQuery.isLoading) return <LoadingScreen />;
  // Guard against non-JSON API responses (e.g. opening the dev server without
  // the /api proxy returns HTML, which parses as text instead of a profile).
  const maybeProfile = profileQuery.data as unknown;
  if (
    profileQuery.isError ||
    !maybeProfile ||
    typeof maybeProfile !== 'object' ||
    typeof (maybeProfile as { role?: unknown }).role !== 'string'
  ) {
    return (
      <MessageScreen
        title="We couldn't load your account"
        body="Check your connection and try again."
        onRetry={() => profileQuery.refetch()}
      />
    );
  }

  const profile = maybeProfile as Profile;
  const buses = campusQuery.data?.buses ?? [];
  if (profile.role === 'admin') return <AdminDashboard profile={profile} />;
  if (profile.role === 'driver') {
    return <DriverDashboard profile={profile} bus={buses.find((bus) => bus.id === profile.assignedBusId) ?? null} />;
  }
  return <StudentDashboard profile={profile} buses={buses} isLoading={campusQuery.isLoading} onRetry={() => campusQuery.refetch()} />;
}

function LoadingScreen() {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.muted, { color: colors.mutedForeground, marginTop: 14 }]}>Opening campus transport</Text>
    </View>
  );
}

function WelcomeScreen() {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={[styles.welcome, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 24 : 42 }]}>
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <View style={styles.heroTop}>
          <View style={[styles.brandMark, { backgroundColor: colors.accent }]}>
            <Ionicons name="navigate" size={25} color={colors.accentForeground} />
          </View>
          <Text style={styles.heroLabel}>CAMPUS TRANSPORT</Text>
        </View>
        <Text style={styles.heroTitle}>Every bus.{'\n'}Right where it is.</Text>
        <Text style={styles.heroBody}>Track campus shuttles from a student's stop to campus. Drivers share their phone location, so there is no extra hardware on the bus.</Text>
        <View style={styles.routeSketch}>
          <View style={styles.routeLine} />
          <View style={[styles.routeStop, { backgroundColor: colors.accent }]} />
          <View style={[styles.routeStop, styles.routeStopEnd]} />
          <View style={styles.routeBus}>
            <Ionicons name="bus" size={22} color={colors.primary} />
          </View>
        </View>
        <Text style={styles.mapCaption}>LIVE LOCATION · DRIVER NOTES · CAMPUS READY</Text>
      </View>
      <View style={styles.welcomeBottom}>
        <Text style={[styles.welcomeTitle, { color: colors.foreground }]}>Your ride, without the guesswork.</Text>
        <Text style={[styles.welcomeSub, { color: colors.mutedForeground }]}>Sign in with your college email to find buses, share a driver's location, or manage campus transport.</Text>
        <Pressable onPress={() => router.push('/sign-in')} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]} testID="welcome-sign-in">
          <Text style={styles.primaryButtonText}>Sign in</Text>
          <Ionicons name="arrow-forward" size={18} color="#ffffff" />
        </Pressable>
        <Pressable onPress={() => router.push('/sign-up')} style={[styles.secondaryButton, { borderColor: colors.border }]} testID="welcome-sign-up">
          <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Create a college account</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Header({ profile, title, subtitle }: { profile: Profile; title: string; subtitle: string }) {
  const colors = useColors();
  const { signOut } = useClerk();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>{subtitle}</Text>
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      <View style={styles.headerActions}>
        <Pressable
          onPress={() => setSettingsOpen(true)}
          accessibilityLabel="Open settings"
          style={[styles.headerIconButton, { backgroundColor: colors.secondary }]}
        >
          <Ionicons name="settings-outline" size={20} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => signOut()}
          accessibilityLabel={`Sign out ${profile.name ?? 'your account'}`}
          style={[styles.avatar, { backgroundColor: colors.secondary }]}
        >
          <Text style={[styles.avatarText, { color: colors.primary }]}>{(profile.name ?? '?').slice(0, 1).toUpperCase()}</Text>
        </Pressable>
      </View>
      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        userName={profile.name ?? 'Campus member'}
        userEmail={profile.email}
        onSignOut={() => signOut()}
      />
    </View>
  );
}

const THEME_MODES: Array<{ id: ThemeMode; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

function SettingsSheet({ visible, onClose, userName, userEmail, onSignOut }: {
  visible: boolean;
  onClose: () => void;
  userName: string;
  userEmail: string;
  onSignOut: () => void;
}) {
  const colors = useColors();
  const { mode, setMode } = useTheme();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetSpacer} onPress={onClose} accessibilityLabel="Close settings" />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Settings</Text>
          <Text style={[styles.smallText, { color: colors.mutedForeground }]}>{userName} · {userEmail}</Text>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 18 }]}>Appearance</Text>
          <View style={styles.modeRow}>
            {THEME_MODES.map((option) => {
              const active = mode === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setMode(option.id)}
                  style={[
                    styles.modeOption,
                    { backgroundColor: active ? colors.primary : colors.secondary, borderColor: colors.border },
                  ]}
                  testID={`theme-${option.id}`}
                >
                  <Text style={{ color: active ? colors.primaryForeground : colors.secondaryForeground, fontWeight: '800', fontSize: 13 }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() => { onClose(); onSignOut(); }}
            style={[styles.logoutButton, { backgroundColor: colors.destructive }]}
            testID="settings-logout"
          >
            <Ionicons name="log-out-outline" size={18} color={colors.destructiveForeground} />
            <Text style={[styles.logoutText, { color: colors.destructiveForeground }]}>Log out</Text>
          </Pressable>
          <Text style={[styles.versionText, { color: colors.mutedForeground }]}>Campus Bus Tracker v{version}</Text>
        </View>
      </View>
    </Modal>
  );
}

function StudentDashboard({ profile, buses, isLoading, onRetry }: {
  profile: Profile;
  buses: Bus[];
  isLoading: boolean;
  onRetry: () => void;
}) {
  const colors = useColors();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const selected = buses.find((bus) => bus.id === selectedId) ?? buses[0] ?? null;
  const liveCount = buses.filter((bus) => isFresh(bus.location?.recordedAt) && bus.onDuty).length;
  // Geocoded stops + road route +ETA re-validated every 20s while a bus is open.
  const routeMapQuery = useGetRouteMap(selected?.id ?? 0, {
    query: {
      queryKey: getGetRouteMapQueryKey(selected?.id ?? 0),
      refetchInterval: 20000,
      enabled: selected != null,
    },
  });
  const routeMap = routeMapQuery.data;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 20 : 10 }]}>
      <ScrollView contentContainerStyle={[styles.pageContent, { paddingBottom: Platform.OS === 'web' ? 130 : 118 }]} showsVerticalScrollIndicator={false}>
        <Header profile={profile} title="Find your bus" subtitle="CAMPUS SHUTTLE" />
        <View style={[styles.statusBanner, { backgroundColor: colors.primary }]}>
          <View style={styles.statusBannerCopy}>
            <Text style={styles.bannerKicker}>ON THE MOVE</Text>
            <Text style={styles.bannerTitle}>{liveCount ? `${liveCount} bus${liveCount === 1 ? '' : 'es'} live now` : 'Campus, in real time'}</Text>
            <Text style={styles.bannerSub}>{liveCount ? 'Choose a bus below to see where it is.' : 'Bus locations appear when a driver starts a shift.'}</Text>
          </View>
          <View style={[styles.bannerIcon, { backgroundColor: colors.accent }]}>
            <Ionicons name="navigate" size={25} color={colors.accentForeground} />
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Live map</Text>
          <Text style={[styles.liveLabel, { color: selected && isFresh(selected.location?.recordedAt) && selected.onDuty ? colors.primary : colors.mutedForeground }]}>
            {selected && isFresh(selected.location?.recordedAt) && selected.onDuty ? '● LIVE' : 'NOT SHARING'}
          </Text>
        </View>
        <BusMap bus={selected} routeMap={routeMap} />
        {selected?.remark && (
          <View style={[styles.remarkCard, { backgroundColor: colors.accent }]}>
            <View style={[styles.remarkIcon, { backgroundColor: colors.primary }]}>
              <Ionicons name="information" size={17} color="#ffffff" />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.eyebrow, { color: colors.accentForeground }]}>DRIVER NOTE · {selected.remark.place}</Text>
              <Text style={[styles.remarkText, { color: colors.accentForeground }]}>{selected.remark.text}</Text>
              <Text style={[styles.remarkBy, { color: colors.secondaryForeground }]}>{selected.remark.driverName} · {formatTime(selected.remark.createdAt)}</Text>
            </View>
          </View>
        )}

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{showAll ? 'All campus buses' : 'Choose a bus'}</Text>
          <Pressable onPress={() => setShowAll((value) => !value)} hitSlop={10}>
            <Text style={[styles.linkText, { color: colors.primary }]}>{showAll ? 'Show less' : 'View all'}</Text>
          </Pressable>
        </View>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 22 }} />
        ) : buses.length === 0 ? (
          <EmptyCard icon="bus-outline" title="No buses added yet" body="Your college transport team will add routes and buses here." />
        ) : (
          <FlatList
            data={showAll ? buses : buses.slice(0, 4)}
            horizontal
            scrollEnabled={buses.length > 1}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.busList}
            keyExtractor={(bus) => String(bus.id)}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => setSelectedId(item.id)}
                style={[
                  styles.busCard,
                  { backgroundColor: colors.card, borderColor: selected?.id === item.id ? colors.primary : colors.border },
                  selected?.id === item.id && styles.selectedBus,
                ]}
                testID={`bus-${item.id}`}
              >
                <View style={styles.busCardTop}>
                  <View style={[styles.busIcon, { backgroundColor: colors.secondary }]}>
                    <Ionicons name="bus" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.busNumber, { color: colors.foreground }]}>Bus {item.busNumber}</Text>
                </View>
                <Text numberOfLines={1} style={[styles.busRoute, { color: colors.mutedForeground }]}>{item.routeName}</Text>
                <View style={styles.busStatusRow}>
                  <View style={[styles.dot, { backgroundColor: item.onDuty && isFresh(item.location?.recordedAt) ? colors.primary : colors.mutedForeground }]} />
                  <Text style={[styles.smallText, { color: colors.mutedForeground }]}>
                    {item.onDuty && isFresh(item.location?.recordedAt) ? 'Location live' : item.location ? `Updated ${formatTime(item.location.recordedAt)}` : 'Waiting for driver'}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        )}
        {selected && (
          <View style={[styles.stopsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Route stops</Text>
              <Text style={[styles.smallText, { color: colors.mutedForeground }]}>Bus {selected.busNumber}</Text>
            </View>
            {selected.routeStops.length ? selected.routeStops.map((stop, index) => {
              const meta = routeMap?.stops?.find((row) => row.name === stop);
              return (
                <View key={`${selected.id}-${stop}-${index}`} style={styles.stopRow}>
                  <View style={styles.stopRail}>
                    <View style={[styles.stopDot, { backgroundColor: meta?.reached ? colors.accent : index === 0 || index === selected.routeStops.length - 1 ? colors.primary : colors.border }]} />
                    {index < selected.routeStops.length - 1 && <View style={[styles.stopLine, { backgroundColor: colors.border }]} />}
                  </View>
                  <Text style={[styles.stopName, { color: colors.foreground }]}>{stop}</Text>
                  <Text style={[styles.stopMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {meta?.reached
                      ? 'Reached'
                      : meta?.etaMin != null
                        ? `${meta.etaMin} min · ${meta.distanceKm != null ? `${meta.distanceKm} km` : ''}`.replace(/ ·$/, '')
                        : ''}
                  </Text>
                </View>
              );
            }) : <Text style={[styles.smallText, { color: colors.mutedForeground }]}>Route stops have not been added yet.</Text>}
          </View>
        )}
        {buses.length > 0 && <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>Bus location is shared from the driver's phone while they are on duty.</Text>}
        {isLoading && <Pressable onPress={onRetry}><Text style={[styles.linkText, { color: colors.primary }]}>Retry</Text></Pressable>}
      </ScrollView>
    </View>
  );
}

function DriverDashboard({ profile, bus }: { profile: Profile; bus: Bus | null }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [remarkText, setRemarkText] = useState('');
  const [place, setPlace] = useState('');
  const [notice, setNotice] = useState('');
  // Route summary shown on the driver's live pill; set when the shift goes live.
  const [liveRoute, setLiveRoute] = useState<string | null>(() => (profile.onDuty ? routeSummary(bus) : null));
  const shift = useUpdateDriverShift();
  const remark = useCreateDriverRemark();
  const locationMutation = useUpdateDriverLocation();
  const [backgroundActive, setBackgroundActive] = useState(false);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetCampusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
  }, [queryClient]);

  // Keep the live pill in sync with the server's duty state.
  useEffect(() => {
    if (profile.onDuty) setLiveRoute((current) => current ?? routeSummary(bus));
    else setLiveRoute(null);
  }, [profile.onDuty, bus]);

  // Foreground fallback: only runs when the background task is not active
  // (background task covers both foreground and background on native).
  useEffect(() => {
    if (!profile.onDuty || !profile.assignedBusId || !permission?.granted || Platform.OS === 'web' || backgroundActive) return;
    let subscription: Location.LocationSubscription | null = null;
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
      (position) => {
        locationMutation.mutate({
          data: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            heading: position.coords.heading,
            speed: position.coords.speed,
            accuracy: position.coords.accuracy,
          },
        });
      },
    ).then((value) => { subscription = value; }).catch(() => setNotice('Location sharing could not start. Check your phone permissions.'));
    return () => subscription?.remove();
  }, [profile.onDuty, profile.assignedBusId, permission?.granted, backgroundActive, locationMutation.mutate]);

  const toggleShift = async (value: boolean) => {
    setNotice('');
    if (value && Platform.OS === 'web') {
      setNotice('Open this app on your phone to share GPS while on duty.');
      return;
    }
    if (value) {
      if (!permission?.granted) {
        const requested = await requestPermission();
        if (!requested.granted) {
          setNotice(requested.canAskAgain ? 'Location permission is needed to share the bus position.' : 'Enable location permission in your phone settings.');
          return;
        }
      }
      // Turn the shift on first so the server accepts location fixes.
      try {
        await shift.mutateAsync({ data: { onDuty: true } });
      } catch {
        setNotice('Could not update your shift. Try again.');
        return;
      }
      // Tell the driver (system notification + in-app) that students can now
      // see them, including the live start → end route when it is mapped.
      const summary = routeSummary(bus);
      void notifyLocationLive(bus?.busNumber ?? null, summary);
      setLiveRoute(summary);
      // Background mode: keep sharing with the screen off or the app minimized.
      const apiUrl = process.env.EXPO_PUBLIC_API_URL;
      try {
        const bg = await Location.requestBackgroundPermissionsAsync();
        if (!bg.granted) {
          setNotice('Sharing with the app open. Allow location “all the time” to keep sharing in the background.');
          refresh();
          return;
        }
        if (!apiUrl) {
          setNotice('Sharing with the app open (no API URL configured for background uploads).');
          refresh();
          return;
        }
        const issued = await customFetch<{ token: string; expiresAt: string }>('/api/driver/upload-token', { method: 'POST' });
        await startBackgroundSharing({ apiUrl, uploadToken: issued.token });
        setBackgroundActive(true);
        setNotice('On duty — sharing continues in the background.');
      } catch {
        setNotice('Background sharing could not start — sharing with the app open instead.');
      }
      refresh();
      void Haptics.selectionAsync();
      return;
    }
    // Ending a shift: stop background uploads, revoke the upload token.
    try {
      await stopBackgroundSharing();
    } catch {
      // best effort; token revocation below still runs
    }
    setBackgroundActive(false);
    try {
      await customFetch('/api/driver/upload-token', { method: 'DELETE' });
    } catch {
      // token expires on its own; ignore
    }
    try {
      await shift.mutateAsync({ data: { onDuty: false } });
      refresh();
      void Haptics.selectionAsync();
      void notifyShiftEnded();
      setLiveRoute(null);
    } catch {
      setNotice('Could not update your shift. Try again.');
    }
  };

  const postRemark = async () => {
    if (!place.trim() || !remarkText.trim()) return;
    try {
      await remark.mutateAsync({ data: { place: place.trim(), text: remarkText.trim() } });
      setPlace('');
      setRemarkText('');
      setNotice('Campus note shared with students.');
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setNotice('Could not post the note. Check your connection and try again.');
    }
  };

  const shareSpot = async (spot: string) => {
    if (remark.isPending) return;
    try {
      await remark.mutateAsync({ data: { place: spot, text: `Parked at ${spot}.` } });
      setNotice(`Shared “${spot}” with students.`);
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setNotice('Could not share the spot. Check your connection and try again.');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 20 : 10 }]}>
      <ScrollView contentContainerStyle={[styles.pageContent, { paddingBottom: Platform.OS === 'web' ? 130 : 118 }]} showsVerticalScrollIndicator={false}>
        <Header profile={profile} title="Driver dashboard" subtitle="YOUR SHIFT" />
        <View style={[styles.driverHero, { backgroundColor: colors.primary }]}>
          <View style={styles.driverHeroTop}>
            <View style={[styles.avatarLarge, { backgroundColor: colors.accent }]}><Ionicons name="bus" size={24} color={colors.accentForeground} /></View>
            <View style={styles.flex}>
              <Text style={styles.bannerKicker}>{bus ? `BUS ${bus.busNumber}` : 'BUS ASSIGNMENT'}</Text>
              <Text style={styles.driverRoute}>{bus?.routeName ?? 'Waiting for your college admin'}</Text>
            </View>
          </View>
          <Text style={styles.driverHeroBody}>
            {profile.onDuty
              ? liveRoute
                ? `Students see you live ${liveRoute} — with the start → end route on their map.`
                : 'Your phone is sharing your bus location with students.'
              : 'Start your shift to share your bus location.'}
          </Text>
          <View style={styles.shiftControl}>
            <View><Text style={styles.shiftTitle}>{profile.onDuty ? 'On duty' : 'Off duty'}</Text><Text style={styles.shiftSub}>{profile.onDuty ? 'GPS sharing is active' : 'Location is not being shared'}</Text></View>
            <Switch
              value={profile.onDuty}
              onValueChange={toggleShift}
              disabled={shift.isPending || !bus}
              trackColor={{ false: '#60756b', true: '#d8f177' }}
              thumbColor="#ffffff"
              testID="driver-shift-toggle"
            />
          </View>
          {profile.onDuty && (
            <View style={styles.livePill}>
              <View style={styles.livePillDot} />
              <Text style={styles.livePillText} numberOfLines={1}>
                {liveRoute ? `Location is live · ${liveRoute}` : 'Location is live — students can track you'}
              </Text>
            </View>
          )}
        </View>
        {!!notice && <Text style={[styles.notice, { color: colors.primary }]}>{notice}</Text>}
        {!bus && <EmptyCard icon="alert-circle-outline" title="No bus assigned" body="Ask your college admin to add your driver account and assign your bus." />}
        {bus && (
          <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Campus parking note</Text>
            <Text style={[styles.smallText, { color: colors.mutedForeground, marginTop: 4, marginBottom: 12 }]}>Tap a spot to share it instantly — students see it on your bus.</Text>
            <View style={styles.spotWrap}>
              {PARKING_SPOTS.map((spot) => (
                <Pressable
                  key={spot}
                  onPress={() => shareSpot(spot)}
                  disabled={remark.isPending}
                  style={({ pressed }) => [
                    styles.spotChip,
                    { backgroundColor: colors.secondary, borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                  testID={`parking-spot-${spot}`}
                >
                  <Ionicons name="location-outline" size={14} color={colors.primary} />
                  <Text style={[styles.spotText, { color: colors.secondaryForeground }]}>{spot}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.smallText, { color: colors.mutedForeground, marginTop: 16, marginBottom: 16 }]}>Or write a custom note:</Text>
            <Field label="Where did you park?" value={place} onChangeText={setPlace} placeholder="Near the Law College" />
            <Field label="What should students know?" value={remarkText} onChangeText={setRemarkText} placeholder="Bus 43 is parked beside the east gate." multiline />
            <ActionButton title={remark.isPending ? 'Posting…' : 'Share note with students'} icon="paper-plane-outline" onPress={postRemark} disabled={!place.trim() || !remarkText.trim() || remark.isPending} />
            {bus.remark && <Text style={[styles.lastNote, { color: colors.mutedForeground }]}>Showing now: {bus.remark.place} — “{bus.remark.text}” · {formatTime(bus.remark.createdAt)}</Text>}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function AdminDashboard({ profile }: { profile: Profile }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [section, setSection] = useState<Section>('overview');
  const overview = useGetAdminOverview({ query: { queryKey: getGetAdminOverviewQueryKey(), refetchInterval: 5000 } });
  const buses = useListAdminBuses({ query: { queryKey: getListAdminBusesQueryKey(), refetchInterval: 5000 } });
  const drivers = useListDrivers({ query: { queryKey: getListDriversQueryKey(), refetchInterval: 10000 } });
  const [busDraft, setBusDraft] = useState({ busNumber: '', routeName: '', routeStops: '', capacity: '40', startCoords: '', endCoords: '' });
  const [editingBus, setEditingBus] = useState<Bus | null>(null);
  const emptyBusDraft = { busNumber: '', routeName: '', routeStops: '', capacity: '40', startCoords: '', endCoords: '' };
  const [driverDraft, setDriverDraft] = useState({ name: '', email: '', busId: '' });
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [locationBus, setLocationBus] = useState<Bus | null>(null);
  const [locationDraft, setLocationDraft] = useState({ latitude: '', longitude: '' });
  const [notice, setNotice] = useState('');
  const createBus = useCreateBus();
  const updateBus = useUpdateBus();
  const deleteBus = useDeleteBus();
  const clearLocation = useClearBusLocation();
  const createDriver = useCreateDriver();
  const updateDriver = useUpdateDriver();
  const deleteDriver = useDeleteDriver();
  const saveLocation = useSetAdminBusLocation();

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetCampusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminBusesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
  }, [queryClient]);

  const beginLocationEdit = (bus: Bus) => {
    setLocationBus(bus);
    setLocationDraft({
      latitude: bus.location ? String(bus.location.latitude) : '',
      longitude: bus.location ? String(bus.location.longitude) : '',
    });
  };

  const submitLocation = async () => {
    const latitude = Number(locationDraft.latitude);
    const longitude = Number(locationDraft.longitude);
    if (
      !locationBus ||
      !locationDraft.latitude.trim() ||
      !locationDraft.longitude.trim() ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      setNotice('Enter valid coordinates: latitude −90 to 90 and longitude −180 to 180.');
      return;
    }
    try {
      await saveLocation.mutateAsync({
        id: locationBus.id,
        data: { latitude, longitude },
      });
      setNotice(`Bus ${locationBus.busNumber} location saved.`);
      setLocationBus(null);
      refresh();
    } catch {
      setNotice('Could not save the location. Check the coordinates and try again.');
    }
  };

  const removeLocation = (bus: Bus) => Alert.alert(
    'Clear bus location?',
    `Students will no longer see the saved map pin for Bus ${bus.busNumber}.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear location', style: 'destructive', onPress: () => clearLocation.mutate({ id: bus.id }, { onSuccess: refresh }) },
    ],
  );

  const submitBus = async () => {
    const stops = busDraft.routeStops.split(',').map((stop) => stop.trim()).filter(Boolean);
    // Route coords: blank = leave the saved route as-is, else require "lat, lon".
    const startField = parseCoordsField(busDraft.startCoords);
    const endField = parseCoordsField(busDraft.endCoords);
    if (startField === null || endField === null) {
      setNotice('Route coordinates need two numbers: “lat, lon” (lat −90…90, lon −180…180).');
      return;
    }
    const data = {
      busNumber: busDraft.busNumber.trim(),
      routeName: busDraft.routeName.trim(),
      routeStops: stops,
      capacity: Number(busDraft.capacity),
      ...(startField ? { startLat: startField.latitude, startLon: startField.longitude } : {}),
      ...(endField ? { endLat: endField.latitude, endLon: endField.longitude } : {}),
    };
    if (!data.busNumber || !data.routeName || !Number.isFinite(data.capacity) || data.capacity < 1) {
      setNotice('Add a bus number, route, and valid capacity.');
      return;
    }
    try {
      if (editingBus) await updateBus.mutateAsync({ id: editingBus.id, data: { ...data, active: editingBus.active } });
      else await createBus.mutateAsync({ data });
      setBusDraft(emptyBusDraft);
      setEditingBus(null);
      setNotice(editingBus ? 'Bus updated.' : 'Bus added.');
      refresh();
    } catch {
      setNotice('Could not save the bus. The number may already be in use.');
    }
  };

  const clearBusRoute = async () => {
    if (!editingBus) return;
    try {
      await updateBus.mutateAsync({
        id: editingBus.id,
        data: { startLat: null, startLon: null, endLat: null, endLon: null },
      });
      setBusDraft(emptyBusDraft);
      setNotice('Route start & destination cleared.');
      refresh();
    } catch {
      setNotice('Could not clear the route coordinates.');
    }
  };

  const beginEditBus = (bus: Bus) => {
    setEditingBus(bus);
    setBusDraft({
      busNumber: bus.busNumber,
      routeName: bus.routeName,
      routeStops: bus.routeStops.join(', '),
      capacity: String(bus.capacity),
      startCoords: bus.startLat != null && bus.startLon != null ? `${bus.startLat}, ${bus.startLon}` : '',
      endCoords: bus.endLat != null && bus.endLon != null ? `${bus.endLat}, ${bus.endLon}` : '',
    });
    setSection('buses');
  };

  const removeBus = (bus: Bus) => Alert.alert('Remove bus?', `Bus ${bus.busNumber} and its tracking history will be removed.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => deleteBus.mutate({ id: bus.id }, { onSuccess: refresh }) },
  ]);

  const submitDriver = async () => {
    if (!driverDraft.name.trim() || !driverDraft.email.trim()) return;
    const data = { name: driverDraft.name.trim(), email: driverDraft.email.trim(), busId: driverDraft.busId ? Number(driverDraft.busId) : null };
    try {
      if (editingDriver) await updateDriver.mutateAsync({ id: editingDriver.id, data });
      else await createDriver.mutateAsync({ data });
      setDriverDraft({ name: '', email: '', busId: '' });
      setEditingDriver(null);
      setNotice(editingDriver ? 'Driver updated.' : 'Driver added. They can sign in with this email.');
      refresh();
    } catch {
      setNotice('Could not save the driver. Check the email and bus assignment.');
    }
  };

  const startEditDriver = (driver: Driver) => {
    setEditingDriver(driver);
    setDriverDraft({ name: driver.name, email: driver.email, busId: driver.busId ? String(driver.busId) : '' });
    setSection('drivers');
  };

  const removeDriver = (driver: Driver) => Alert.alert('Remove driver?', `${driver.name} will no longer have driver access.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => deleteDriver.mutate({ id: driver.id }, { onSuccess: refresh }) },
  ]);

  const totalBuses = overview.data?.totalBuses ?? 0;
  const busList = buses.data ?? [];
  const driverList = drivers.data ?? [];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 20 : 10 }]}>
      <ScrollView contentContainerStyle={[styles.pageContent, { paddingBottom: Platform.OS === 'web' ? 130 : 118 }]} showsVerticalScrollIndicator={false}>
        <Header profile={profile} title="Transport admin" subtitle="CAMPUS OPERATIONS" />
        <View style={[styles.adminSummary, { backgroundColor: colors.primary }]}>
          <View><Text style={styles.bannerKicker}>LIVE FLEET</Text><Text style={styles.adminSummaryNumber}>{overview.data?.busesSharingLocation ?? 0}<Text style={styles.adminSummarySmall}> / {overview.data?.activeBuses ?? totalBuses}</Text></Text><Text style={styles.bannerSub}>buses sharing a fresh location</Text></View>
          <View style={[styles.bannerIcon, { backgroundColor: colors.accent }]}><Ionicons name="speedometer-outline" size={24} color={colors.accentForeground} /></View>
        </View>
        <View style={styles.statsRow}>
          <Stat label="Buses" value={overview.data?.totalBuses ?? 0} icon="bus-outline" />
          <Stat label="Drivers" value={overview.data?.totalDrivers ?? 0} icon="people-outline" />
          <Stat label="On duty" value={overview.data?.driversOnDuty ?? 0} icon="radio-outline" />
        </View>
        <View style={[styles.sectionTabs, { backgroundColor: colors.secondary }]}>
          {(['overview', 'buses', 'drivers'] as Section[]).map((item) => (
            <Pressable key={item} onPress={() => { setSection(item); setNotice(''); }} style={[styles.sectionTab, section === item && { backgroundColor: colors.card }]}>
              <Text style={[styles.sectionTabText, { color: section === item ? colors.foreground : colors.mutedForeground }]}>{item[0].toUpperCase() + item.slice(1)}</Text>
            </Pressable>
          ))}
        </View>
        {!!notice && <Text style={[styles.notice, { color: colors.primary }]}>{notice}</Text>}
        {section === 'overview' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Fleet locations</Text>
            {busList.length === 0 ? <EmptyCard icon="bus-outline" title="No buses yet" body="Add your first bus from the Buses tab." /> : busList.map((bus) => (
              <View key={bus.id} style={[styles.fleetRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.busIcon, { backgroundColor: colors.secondary }]}><Ionicons name="bus" size={20} color={colors.primary} /></View>
                <View style={styles.flex}><Text style={[styles.busNumber, { color: colors.foreground }]}>Bus {bus.busNumber}</Text><Text style={[styles.smallText, { color: colors.mutedForeground }]}>{bus.routeName} · {bus.onDuty && isFresh(bus.location?.recordedAt) ? 'Live now' : bus.location ? `Updated ${formatTime(bus.location.recordedAt)}` : 'No location yet'}</Text></View>
                <Pressable accessibilityLabel={`Set location for bus ${bus.busNumber}`} onPress={() => beginLocationEdit(bus)} style={styles.iconButton}><Ionicons name="location-outline" size={19} color={colors.primary} /></Pressable>
                <Pressable accessibilityLabel={`Clear location for bus ${bus.busNumber}`} onPress={() => removeLocation(bus)} style={styles.iconButton}><Ionicons name="trash-outline" size={18} color={colors.destructive} /></Pressable>
              </View>
            ))}
            <Text style={[styles.smallText, { color: colors.mutedForeground, marginTop: 4, marginBottom: 14 }]}>Drivers share live GPS from their phones. Admins can also set or clear a map pin for campus adjustments.</Text>
            {locationBus && (
              <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Set Bus {locationBus.busNumber} map pin</Text>
                <Text style={[styles.smallText, { color: colors.mutedForeground, marginTop: 5 }]}>Use decimal coordinates. A driver’s next GPS update will replace this pin.</Text>
                <Field label="Latitude" value={locationDraft.latitude} onChangeText={(value) => setLocationDraft((draft) => ({ ...draft, latitude: value }))} placeholder="19.0760" keyboardType="default" />
                <Field label="Longitude" value={locationDraft.longitude} onChangeText={(value) => setLocationDraft((draft) => ({ ...draft, longitude: value }))} placeholder="72.8777" keyboardType="default" />
                <ActionButton title={saveLocation.isPending ? 'Saving…' : 'Save map pin'} icon="location-outline" onPress={submitLocation} disabled={saveLocation.isPending} />
                <Pressable onPress={() => setLocationBus(null)} style={styles.cancelButton}><Text style={[styles.linkText, { color: colors.mutedForeground }]}>Cancel</Text></Pressable>
              </View>
            )}
          </>
        )}
        {section === 'buses' && (
          <>
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{editingBus ? `Edit bus ${editingBus.busNumber}` : 'Add a bus'}</Text>
              <Field label="Bus number" value={busDraft.busNumber} onChangeText={(value) => setBusDraft((draft) => ({ ...draft, busNumber: value }))} placeholder="43" />
              <Field label="Route name" value={busDraft.routeName} onChangeText={(value) => setBusDraft((draft) => ({ ...draft, routeName: value }))} placeholder="Law College loop" />
              <Field label="Stops, separated by commas" value={busDraft.routeStops} onChangeText={(value) => setBusDraft((draft) => ({ ...draft, routeStops: value }))} placeholder="Main gate, Library, Law College" />
              <Field label="Seat capacity" value={busDraft.capacity} onChangeText={(value) => setBusDraft((draft) => ({ ...draft, capacity: value.replace(/[^0-9]/g, '') }))} placeholder="40" keyboardType="number-pad" />
              <Field label="Start point (lat, lon) — optional" value={busDraft.startCoords} onChangeText={(value) => setBusDraft((draft) => ({ ...draft, startCoords: value }))} placeholder="12.9350, 77.5230" />
              <Field label="Destination (lat, lon) — optional" value={busDraft.endCoords} onChangeText={(value) => setBusDraft((draft) => ({ ...draft, endCoords: value }))} placeholder="12.9420, 77.5510" />
              <Text style={[styles.smallText, { color: colors.mutedForeground, marginBottom: 12 }]}>While the driver is live, students see the dashed route between these two pins on the map. Leave blank to keep the saved route.</Text>
              <ActionButton title={editingBus ? 'Save bus' : 'Add bus'} icon={editingBus ? 'checkmark' : 'add'} onPress={submitBus} disabled={createBus.isPending || updateBus.isPending} />
              {editingBus && (editingBus.startLat != null || editingBus.endLat != null) && (
                <Pressable accessibilityLabel="Clear saved route coordinates" onPress={clearBusRoute} style={styles.cancelButton}>
                  <Text style={[styles.linkText, { color: colors.destructive }]}>Clear saved route start & destination</Text>
                </Pressable>
              )}
              {editingBus && <Pressable onPress={() => { setEditingBus(null); setBusDraft(emptyBusDraft); }} style={styles.cancelButton}><Text style={[styles.linkText, { color: colors.mutedForeground }]}>Cancel edit</Text></Pressable>}
            </View>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>All buses</Text>
            {busList.map((bus) => (
              <View key={bus.id} style={[styles.fleetRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.flex}><Text style={[styles.busNumber, { color: colors.foreground }]}>Bus {bus.busNumber}</Text><Text style={[styles.smallText, { color: colors.mutedForeground }]}>{bus.routeName} · {bus.capacity} seats</Text></View>
                <Pressable accessibilityLabel={`Edit bus ${bus.busNumber}`} onPress={() => beginEditBus(bus)} style={styles.iconButton}><Ionicons name="create-outline" size={19} color={colors.primary} /></Pressable>
                <Pressable accessibilityLabel={`Remove bus ${bus.busNumber}`} onPress={() => removeBus(bus)} style={styles.iconButton}><Ionicons name="trash-outline" size={19} color={colors.destructive} /></Pressable>
              </View>
            ))}
          </>
        )}
        {section === 'drivers' && (
          <>
            <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{editingDriver ? 'Edit driver' : 'Add a driver'}</Text>
              <Field label="Driver name" value={driverDraft.name} onChangeText={(value) => setDriverDraft((draft) => ({ ...draft, name: value }))} placeholder="Driver name" />
              <Field label="College email" value={driverDraft.email} onChangeText={(value) => setDriverDraft((draft) => ({ ...draft, email: value }))} placeholder="driver@college.edu" keyboardType="email-address" autoCapitalize="none" />
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Assign a bus</Text>
              <View style={styles.busChoices}>
                {busList.map((bus) => (
                  <Pressable key={bus.id} onPress={() => setDriverDraft((draft) => ({ ...draft, busId: String(bus.id) }))} style={[styles.choice, { borderColor: driverDraft.busId === String(bus.id) ? colors.primary : colors.border, backgroundColor: driverDraft.busId === String(bus.id) ? colors.secondary : colors.card }]}>
                    <Text style={[styles.choiceText, { color: colors.foreground }]}>Bus {bus.busNumber}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setDriverDraft((draft) => ({ ...draft, busId: '' }))} style={[styles.choice, { borderColor: !driverDraft.busId ? colors.primary : colors.border, backgroundColor: !driverDraft.busId ? colors.secondary : colors.card }]}>
                  <Text style={[styles.choiceText, { color: colors.foreground }]}>Unassigned</Text>
                </Pressable>
              </View>
              <ActionButton title={editingDriver ? 'Save driver' : 'Add driver'} icon={editingDriver ? 'checkmark' : 'person-add-outline'} onPress={submitDriver} disabled={!driverDraft.name.trim() || !driverDraft.email.trim() || createDriver.isPending || updateDriver.isPending} />
              {editingDriver && <Pressable onPress={() => { setEditingDriver(null); setDriverDraft({ name: '', email: '', busId: '' }); }} style={styles.cancelButton}><Text style={[styles.linkText, { color: colors.mutedForeground }]}>Cancel edit</Text></Pressable>}
            </View>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Drivers</Text>
            {driverList.length === 0 ? <EmptyCard icon="people-outline" title="No drivers added" body="Add drivers by their college email. Their account receives driver access when they sign in." /> : driverList.map((driver) => (
              <View key={driver.id} style={[styles.fleetRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.flex}><Text style={[styles.busNumber, { color: colors.foreground }]}>{driver.name}</Text><Text style={[styles.smallText, { color: colors.mutedForeground }]}>{driver.email} · {driver.busNumber ? `Bus ${driver.busNumber}` : 'Unassigned'}</Text></View>
                <Pressable accessibilityLabel={`Edit ${driver.name}`} onPress={() => startEditDriver(driver)} style={styles.iconButton}><Ionicons name="create-outline" size={19} color={colors.primary} /></Pressable>
                <Pressable accessibilityLabel={`Remove ${driver.name}`} onPress={() => removeDriver(driver)} style={styles.iconButton}><Ionicons name="trash-outline" size={19} color={colors.destructive} /></Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline, keyboardType, autoCapitalize }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline && styles.multilineInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
      />
    </View>
  );
}

function ActionButton({ title, icon, onPress, disabled }: { title: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, disabled && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name={icon} size={18} color="#ffffff" />
      <Text style={styles.primaryButtonText}>{title}</Text>
    </Pressable>
  );
}

function EmptyCard({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  const colors = useColors();
  return (
    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Ionicons name={icon} size={21} color={colors.primary} /></View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.smallText, { color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 }]}>{body}</Text>
    </View>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap }) {
  const colors = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.smallText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function MessageScreen({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background, padding: 28 }]}>
      <Ionicons name="cloud-offline-outline" size={30} color={colors.primary} />
      <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 16 }]}>{title}</Text>
      <Text style={[styles.smallText, { color: colors.mutedForeground, textAlign: 'center', marginTop: 8 }]}>{body}</Text>
      <Pressable onPress={onRetry} style={[styles.primaryButton, { backgroundColor: colors.primary, paddingHorizontal: 26 }]}><Text style={styles.primaryButtonText}>Try again</Text></Pressable>
    </View>
  );
}

function isFresh(value?: string | null) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 90_000;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'just now';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pageContent: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  welcome: { flex: 1, paddingHorizontal: 20, paddingBottom: 30 },
  hero: { borderRadius: 28, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 22, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heroLabel: { color: '#dcebe3', letterSpacing: 1.6, fontSize: 10, fontWeight: '800' },
  heroTitle: { color: '#ffffff', fontSize: 38, lineHeight: 42, fontWeight: '800', letterSpacing: -1.3, marginTop: 30 },
  heroBody: { color: '#dcebe3', fontSize: 14, lineHeight: 21, maxWidth: 310, marginTop: 12 },
  routeSketch: { height: 63, marginTop: 28, justifyContent: 'center', flexDirection: 'row', alignItems: 'center' },
  routeLine: { position: 'absolute', height: 3, left: 16, right: 16, backgroundColor: '#81aa8e', borderRadius: 4 },
  routeStop: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: '#176d5d', position: 'absolute', left: 10 },
  routeStopEnd: { left: undefined, right: 10, backgroundColor: '#ffffff' },
  routeBus: { position: 'absolute', width: 46, height: 46, backgroundColor: '#ffffff', borderRadius: 17, alignItems: 'center', justifyContent: 'center', left: '47%' },
  mapCaption: { color: '#c1d3c8', fontSize: 9, letterSpacing: 1.1, fontWeight: '800', marginTop: 6 },
  welcomeBottom: { flex: 1, justifyContent: 'center', paddingHorizontal: 4, paddingTop: 22 },
  welcomeTitle: { fontSize: 25, fontWeight: '800', letterSpacing: -0.6 },
  welcomeSub: { fontSize: 14, lineHeight: 21, marginTop: 9, marginBottom: 22 },
  primaryButton: { minHeight: 52, borderRadius: 15, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
  secondaryButton: { minHeight: 52, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryButtonText: { fontWeight: '700', fontSize: 14 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerText: { flex: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '800' },
  pageTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 },
  avatar: { height: 42, width: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '800' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconButton: { height: 42, width: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  spotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spotChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 13 },
  spotText: { fontSize: 12, fontWeight: '800' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetSpacer: { flex: 1 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, padding: 22, paddingBottom: 34 },
  sheetTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  modeOption: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  logoutButton: { marginTop: 20, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  logoutText: { fontSize: 15, fontWeight: '800' },
  versionText: { fontSize: 11, textAlign: 'center', marginTop: 16 },
  statusBanner: { padding: 18, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  statusBannerCopy: { flex: 1, paddingRight: 10 },
  bannerKicker: { color: '#c9e1d6', fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  bannerTitle: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginTop: 6 },
  bannerSub: { color: '#cfe0d5', fontSize: 12, lineHeight: 18, marginTop: 3 },
  bannerIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  liveLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  mapFrame: { height: 252, borderRadius: 22, overflow: 'hidden', borderWidth: 1, marginBottom: 15 },
  mapEmpty: { height: 220, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 9, marginBottom: 15 },
  mapEmptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  mapBusIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  marker: { width: 43, height: 43, borderRadius: 16, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  mapAttribution: { position: 'absolute', bottom: 6, left: 7, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3 },
  mapAttributionText: { fontSize: 9 },
  mapLabel: { position: 'absolute', top: 11, left: 11, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  mapLabelText: { fontSize: 12, fontWeight: '800' },
  busList: { gap: 10, paddingBottom: 12 },
  busCard: { width: 178, borderWidth: 1, borderRadius: 18, padding: 13 },
  selectedBus: { borderWidth: 2 },
  busCardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  busIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  busNumber: { fontSize: 14, fontWeight: '800' },
  busRoute: { fontSize: 12, marginTop: 9 },
  busStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  smallText: { fontSize: 11, lineHeight: 16 },
  remarkCard: { borderRadius: 18, padding: 14, flexDirection: 'row', gap: 10, marginBottom: 20 },
  remarkIcon: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  remarkText: { fontSize: 14, fontWeight: '700', lineHeight: 19, marginTop: 5 },
  remarkBy: { fontSize: 10, marginTop: 7 },
  linkText: { fontSize: 12, fontWeight: '800' },
  stopsCard: { borderRadius: 20, padding: 16, borderWidth: 1, marginTop: 12 },
  stopRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 12 },
  stopRail: { width: 16, alignItems: 'center', height: '100%', justifyContent: 'center' },
  stopDot: { height: 9, width: 9, borderRadius: 5, zIndex: 1 },
  stopLine: { width: 2, position: 'absolute', top: 0, bottom: 0 },
  stopName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  stopMeta: { marginLeft: 'auto', fontSize: 11, fontWeight: '700', flexShrink: 0 },
  disclaimer: { marginTop: 14, fontSize: 10, textAlign: 'center' },
  driverHero: { borderRadius: 22, padding: 18, marginBottom: 18 },
  driverHeroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarLarge: { height: 52, width: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  driverRoute: { color: '#ffffff', fontSize: 17, fontWeight: '800', marginTop: 4 },
  driverHeroBody: { color: '#d5e7dc', lineHeight: 20, fontSize: 13, marginTop: 18 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(216, 241, 119, 0.16)', borderWidth: 1, borderColor: 'rgba(216, 241, 119, 0.45)', borderRadius: 20, paddingHorizontal: 13, paddingVertical: 8, marginTop: 14 },
  livePillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d8f177' },
  livePillText: { color: '#d8f177', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  shiftControl: { borderTopWidth: 1, borderTopColor: '#46766a', marginTop: 18, paddingTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shiftTitle: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
  shiftSub: { color: '#c9dbd1', fontSize: 11, marginTop: 3 },
  notice: { fontSize: 12, lineHeight: 18, marginBottom: 14 },
  formCard: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 22 },
  fieldWrap: { marginTop: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '700', marginBottom: 7 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, fontSize: 13 },
  multilineInput: { minHeight: 78, textAlignVertical: 'top' },
  lastNote: { fontSize: 11, lineHeight: 17, marginTop: 14 },
  disabled: { opacity: 0.5 },
  flex: { flex: 1 },
  adminSummary: { borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  adminSummaryNumber: { color: '#ffffff', fontSize: 36, fontWeight: '800', marginTop: 5 },
  adminSummarySmall: { fontSize: 18, color: '#c9dbd1', fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  stat: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 12, alignItems: 'center', gap: 5 },
  statValue: { fontSize: 20, fontWeight: '800' },
  sectionTabs: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 3, marginBottom: 20 },
  sectionTab: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  sectionTabText: { fontSize: 12, fontWeight: '800' },
  fleetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, padding: 12, borderRadius: 16, marginBottom: 9 },
  iconButton: { padding: 7 },
  emptyCard: { alignItems: 'center', padding: 22, borderRadius: 18, borderWidth: 1, gap: 8, marginBottom: 16 },
  emptyIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  emptyTitle: { fontSize: 14, fontWeight: '800' },
  busChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  choice: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  choiceText: { fontSize: 11, fontWeight: '700' },
  cancelButton: { marginTop: 12, alignItems: 'center' },
  muted: { fontSize: 13 },
});
