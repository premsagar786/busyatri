import { useEffect, useRef } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { B, brutal } from "../src/ui/theme";
import { useTrip } from "../src/store/tripStore";
import { beginTrip, finishTrip, resumeIfNeeded } from "../src/tracking/session";
import { syncLoop, syncState } from "../src/queue/sync";
import { countQueued, loadSession } from "../src/queue/db";
import { ago, kmh } from "../src/utils/format";
import { getApiUrl } from "../src/api/endpoint";

export default function Home() {
  const s = useTrip();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      const bus = await loadSession("busyatri_bus");
      const token = await loadSession("busyatri_token");
      if (!bus || !token) { router.replace("/login"); return; }
      s.set({ busNumber: bus, token });
      const prev = await resumeIfNeeded();
      if (prev) {
        Alert.alert("RESUME TRIP?", `${prev.tripId} was active. Resume?`, [
          { text: "DISCARD", style: "destructive", onPress: () => finishTrip() },
          { text: "RESUME", onPress: () => {
            s.set({ tripId: prev.tripId, active: true, startedAt: new Date().toISOString() });
            startSync(prev.tripId, token);
          } },
        ]);
      }
      const c = await countQueued();
      s.set({ queued: c.queued, sent: c.sent });
    })();
    const t = setInterval(async () => {
      const c = await countQueued();
      s.set({ queued: c.queued, sent: c.sent, lastSync: syncState.lastSync });
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startSync(tripId: string, token: string) {
    abort.current?.abort();
    abort.current = new AbortController();
    syncLoop(abort.current.signal, { tripId, token }).catch((e) => console.error(e));
  }

  async function toggle() {
    if (!s.active) {
      const id = await beginTrip(s.busNumber || "BUS", { apiUrl: await getApiUrl(), token: s.token || "" });
      s.set({ tripId: id, active: true, startedAt: new Date().toISOString() });
      startSync(id, s.token!);
      router.push("/trip");
    } else {
      abort.current?.abort();
      try {
        const api = await getApiUrl();
        await fetch(`${api}/api/v1/buses/trips/${encodeURIComponent(s.tripId!)}/end`, {
          method: "POST", headers: { Authorization: `Bearer ${s.token}` },
        });
      } catch (e) { console.warn("end-trip remote failed (queued data is safe)", e); }
      await finishTrip();
      s.set({ active: false });
      router.push("/summary");
    }
  }

  const chipColor = !s.online ? B.red : s.queued > 0 ? B.amber : B.lime;
  const chipText = !s.online ? `OFFLINE ● ${s.queued} QUEUED` : s.queued > 0 ? `SYNCING ● ${s.queued}` : "ONLINE ● LIVE";

  return (
    <View style={brutal.screen}>
      <View style={brutal.headerBlock}>
        <Text style={brutal.headerText}>{s.busNumber || "BUS─?"}</Text>
        <Text style={brutal.headerSub}>{s.route || "—"} → {s.destination || "—"} / DRIVER APP</Text>
      </View>

      <View style={[brutal.card, { backgroundColor: chipColor }]}>
        <Text style={[brutal.chip, { backgroundColor: "#fff", alignSelf: "flex-start" }]}>{chipText}</Text>
        <Text style={{ fontWeight: "800", marginTop: 8 }}>LAST SYNC: {ago(s.lastSync)} / SENT: {s.sent} / QUEUED: {s.queued}</Text>
      </View>

      <Pressable style={[brutal.bigBtn, { backgroundColor: s.active ? B.red : B.lime }]} onPress={toggle}>
        <Text style={[brutal.bigBtnText, s.active ? { color: "#fff" } : {}]}>{s.active ? "■ END TRIP" : "▶ START TRIP"}</Text>
      </Pressable>

      <View style={brutal.statGrid}>
        <View style={brutal.stat}><Text style={brutal.statKey}>SPEED</Text><Text style={brutal.statVal}>{kmh(s.speed)}</Text></View>
        <View style={brutal.stat}><Text style={brutal.statKey}>ACCURACY</Text><Text style={brutal.statVal}>{s.accuracy != null ? `${s.accuracy.toFixed(0)}m` : "—"}</Text></View>
      </View>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Pressable style={[brutal.bigBtn, { flex: 1, backgroundColor: "#fff", padding: 12 }]} onPress={() => router.push("/trip")}>
          <Text style={{ fontWeight: "900" }}>TRIP →</Text>
        </Pressable>
        <Pressable style={[brutal.bigBtn, { flex: 1, backgroundColor: "#fff", padding: 12 }]} onPress={() => router.push("/settings")}>
          <Text style={{ fontWeight: "900" }}>SETUP →</Text>
        </Pressable>
      </View>
    </View>
  );
}
