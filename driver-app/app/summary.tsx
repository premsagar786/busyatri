import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { B, brutal } from "../src/ui/theme";
import { useTrip } from "../src/store/tripStore";

export default function Summary() {
  const s = useTrip();
  return (
    <View style={brutal.screen}>
      <View style={brutal.headerBlock}>
        <Text style={brutal.headerText}>TRIP DONE ✓</Text>
        <Text style={brutal.headerSub}>{s.tripId}</Text>
      </View>
      <View style={brutal.cardHard}>
        <Text style={brutal.label}>SUMMARY</Text>
        <Text style={{ fontWeight: "800", fontSize: 16 }}>POINTS SENT: {s.sent}</Text>
        <Text style={{ fontWeight: "800", fontSize: 16 }}>STILL QUEUED: {s.queued} (WILL UPLOAD)</Text>
      </View>
      <Pressable style={[brutal.bigBtn, { backgroundColor: B.yellow }]} onPress={() => router.replace("/")}>
        <Text style={brutal.bigBtnText}>← HOME</Text>
      </Pressable>
    </View>
  );
}
