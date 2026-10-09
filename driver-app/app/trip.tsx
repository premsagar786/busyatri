import { View, Text } from "react-native";
import { brutal } from "../src/ui/theme";
import { useTrip } from "../src/store/tripStore";
import { ago, kmh, fmtDur } from "../src/utils/format";

export default function Trip() {
  const s = useTrip();
  const elapsed = s.startedAt ? Date.now() - Date.parse(s.startedAt) : 0;
  return (
    <View style={brutal.screen}>
      <View style={brutal.headerBlock}>
        <Text style={brutal.headerText}>● TRIP LIVE</Text>
        <Text style={brutal.headerSub}>{s.tripId || "NO TRIP"}</Text>
      </View>
      <View style={brutal.statGrid}>
        <View style={brutal.stat}><Text style={brutal.statKey}>ELAPSED</Text><Text style={brutal.statVal}>{fmtDur(elapsed)}</Text></View>
        <View style={brutal.stat}><Text style={brutal.statKey}>SPEED</Text><Text style={brutal.statVal}>{kmh(s.speed)}</Text></View>
        <View style={brutal.stat}><Text style={brutal.statKey}>QUEUED</Text><Text style={brutal.statVal}>{s.queued}</Text></View>
        <View style={brutal.stat}><Text style={brutal.statKey}>SENT</Text><Text style={brutal.statVal}>{s.sent}</Text></View>
      </View>
      <View style={[brutal.card, { marginTop: 12 }]}>
        <Text style={brutal.label}>SYNC</Text>
        <Text style={{ fontWeight: "700" }}>LAST: {ago(s.lastSync)} / NET: {s.online ? "ONLINE" : "OFFLINE"}</Text>
        <Text style={{ fontWeight: "700", marginTop: 6 }}>DO NOT KILL APP. FOREGROUND SERVICE KEEPS GPS ALIVE.</Text>
      </View>
    </View>
  );
}
