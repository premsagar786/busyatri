import { useClerk, useAuth } from '@clerk/expo';
import {
  useClearBusLocation,
  useCreateBus,
  useCreateDriver,
  useCreateDriverRemark,
  useDeleteBus,
  useDeleteDriver,
  useGetAdminOverview,
  useGetCampus,
  useGetMe,
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
} from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import BusMap from '@/components/BusMap';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

type Section = 'overview' | 'buses' | 'drivers';

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
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>{subtitle}</Text>
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      <Pressable
        onPress={() => signOut()}
        accessibilityLabel={`Sign out ${profile.name ?? 'your account'}`}
        style={[styles.avatar, { backgroundColor: colors.secondary }]}
      >
        <Text style={[styles.avatarText, { color: colors.primary }]}>{(profile.name ?? '?').slice(0, 1).toUpperCase()}</Text>
      </Pressable>
    </View>
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
        <BusMap bus={selected} />
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
            {selected.routeStops.length ? selected.routeStops.map((stop, index) => (
              <View key={`${selected.id}-${stop}-${index}`} style={styles.stopRow}>
                <View style={styles.stopRail}>
                  <View style={[styles.stopDot, { backgroundColor: index === 0 || index === selected.routeStops.length - 1 ? colors.primary : colors.border }]} />
                  {index < selected.routeStops.length - 1 && <View style={[styles.stopLine, { backgroundColor: colors.border }]} />}
                </View>
                <Text style={[styles.stopName, { color: colors.foreground }]}>{stop}</Text>
              </View>
            )) : <Text style={[styles.smallText, { color: colors.mutedForeground }]}>Route stops have not been added yet.</Text>}
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
  const shift = useUpdateDriverShift();
  const remark = useCreateDriverRemark();
  const locationMutation = useUpdateDriverLocation();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetCampusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
  }, [queryClient]);

  useEffect(() => {
    if (!profile.onDuty || !profile.assignedBusId || !permission?.granted || Platform.OS === 'web') return;
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
  }, [profile.onDuty, profile.assignedBusId, permission?.granted, locationMutation.mutate]);

  const toggleShift = async (value: boolean) => {
    setNotice('');
    if (value && Platform.OS === 'web') {
      setNotice('Open this app on your phone to share GPS while on duty.');
      return;
    }
    if (value && !permission?.granted) {
      const requested = await requestPermission();
      if (!requested.granted) {
        setNotice(requested.canAskAgain ? 'Location permission is needed to share the bus position.' : 'Enable location permission in your phone settings.');
        return;
      }
    }
    try {
      await shift.mutateAsync({ data: { onDuty: value } });
      refresh();
      void Haptics.selectionAsync();
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
          <Text style={styles.driverHeroBody}>{profile.onDuty ? 'Your phone is sharing your bus location with students.' : 'Start your shift to share your bus location.'}</Text>
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
        </View>
        {!!notice && <Text style={[styles.notice, { color: colors.primary }]}>{notice}</Text>}
        {!bus && <EmptyCard icon="alert-circle-outline" title="No bus assigned" body="Ask your college admin to add your driver account and assign your bus." />}
        {bus && (
          <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Campus parking note</Text>
            <Text style={[styles.smallText, { color: colors.mutedForeground, marginTop: 4, marginBottom: 16 }]}>Help students find you while buses are being parked on campus.</Text>
            <Field label="Where did you park?" value={place} onChangeText={setPlace} placeholder="Near the Law College" />
            <Field label="What should students know?" value={remarkText} onChangeText={setRemarkText} placeholder="Bus 43 is parked beside the east gate." multiline />
            <ActionButton title={remark.isPending ? 'Posting…' : 'Share note with students'} icon="paper-plane-outline" onPress={postRemark} disabled={!place.trim() || !remarkText.trim() || remark.isPending} />
            {bus.remark && <Text style={[styles.lastNote, { color: colors.mutedForeground }]}>Last note: “{bus.remark.text}” · {formatTime(bus.remark.createdAt)}</Text>}
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
  const [busDraft, setBusDraft] = useState({ busNumber: '', routeName: '', routeStops: '', capacity: '40' });
  const [editingBus, setEditingBus] = useState<Bus | null>(null);
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
    const data = { busNumber: busDraft.busNumber.trim(), routeName: busDraft.routeName.trim(), routeStops: stops, capacity: Number(busDraft.capacity) };
    if (!data.busNumber || !data.routeName || !Number.isFinite(data.capacity) || data.capacity < 1) {
      setNotice('Add a bus number, route, and valid capacity.');
      return;
    }
    try {
      if (editingBus) await updateBus.mutateAsync({ id: editingBus.id, data: { ...data, active: editingBus.active } });
      else await createBus.mutateAsync({ data });
      setBusDraft({ busNumber: '', routeName: '', routeStops: '', capacity: '40' });
      setEditingBus(null);
      setNotice(editingBus ? 'Bus updated.' : 'Bus added.');
      refresh();
    } catch {
      setNotice('Could not save the bus. The number may already be in use.');
    }
  };

  const beginEditBus = (bus: Bus) => {
    setEditingBus(bus);
    setBusDraft({ busNumber: bus.busNumber, routeName: bus.routeName, routeStops: bus.routeStops.join(', '), capacity: String(bus.capacity) });
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
              <ActionButton title={editingBus ? 'Save bus' : 'Add bus'} icon={editingBus ? 'checkmark' : 'add'} onPress={submitBus} disabled={createBus.isPending || updateBus.isPending} />
              {editingBus && <Pressable onPress={() => { setEditingBus(null); setBusDraft({ busNumber: '', routeName: '', routeStops: '', capacity: '40' }); }} style={styles.cancelButton}><Text style={[styles.linkText, { color: colors.mutedForeground }]}>Cancel edit</Text></Pressable>}
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
  stopName: { fontSize: 13, fontWeight: '600' },
  disclaimer: { marginTop: 14, fontSize: 10, textAlign: 'center' },
  driverHero: { borderRadius: 22, padding: 18, marginBottom: 18 },
  driverHeroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarLarge: { height: 52, width: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  driverRoute: { color: '#ffffff', fontSize: 17, fontWeight: '800', marginTop: 4 },
  driverHeroBody: { color: '#d5e7dc', lineHeight: 20, fontSize: 13, marginTop: 18 },
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
