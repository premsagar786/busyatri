import { View, Text, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { B, brutal } from "../src/ui/theme";
import { ensurePermissions } from "../src/tracking/session";

export default function Permissions() {
  async function go() {
    const { fg, bg } = await ensurePermissions();
    if (!fg) {
      Alert.alert("LOCATION NEEDED", "Grant foreground location to continue.");
      return;
    }
    if (!bg) {
      Alert.alert("BACKGROUND = TRACKING", "Choose 'Allow all the time' or tracking stops when app hides.");
    }
    router.replace("/");
  }

  return (
    <View style={brutal.screen}>
      <View style={brutal.headerBlock}>
        <Text style={brutal.headerText}>WHY GPS?</Text>
        <Text style={brutal.headerSub}>READ THIS. THEN TAP.</Text>
      </View>
      {[
        ["1 / FOREGROUND", "Live position every 10s while trip is ON."],
        ["2 / BACKGROUND", "Keeps sending when phone is locked. Foreground service shows 'Trip active'."],
        ["3 / OFFLINE QUEUE", "No signal? Points stay on phone, upload later. Nothing is lost."],
      ].map(([t, d]) => (
        <View key={t} style={brutal.card}>
          <Text style={brutal.label}>{t}</Text>
          <Text style={{ fontWeight: "700" }}>{d}</Text>
        </View>
      ))}
      <Pressable style={[brutal.bigBtn, { backgroundColor: B.lime }]} onPress={go}>
        <Text style={brutal.bigBtnText}>GRANT + CONTINUE →</Text>
      </Pressable>
    </View>
  );
}
