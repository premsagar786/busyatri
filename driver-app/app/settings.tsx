import { useEffect, useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { B, brutal } from "../src/ui/theme";
import { clearSession } from "../src/queue/db";
import { useTrip } from "../src/store/tripStore";
import { getApiUrl } from "../src/api/endpoint";

export default function Settings() {
  const reset = useTrip((s) => s.reset);
  const [api, setApi] = useState("…");
  useEffect(() => { getApiUrl().then(setApi); }, []);
  async function signOut() {
    await clearSession("busyatri_bus");
    await clearSession("busyatri_token");
    reset();
    router.replace("/login");
  }
  return (
    <View style={brutal.screen}>
      <View style={brutal.headerBlock}>
        <Text style={brutal.headerText}>SETUP</Text>
        <Text style={brutal.headerSub}>INTERVAL 10s / BALANCED GPS</Text>
      </View>
      <View style={brutal.card}>
        <Text style={brutal.label}>SERVER (FROM QR OR BUILD)</Text>
        <Text style={{ fontWeight: "700" }}>{api}</Text>
        <Text style={{ fontWeight: "700", marginTop: 8 }}>GPS: BALANCED (10s). HIGH-ACCURACY IN CODE IF NEEDED.</Text>
      </View>
      <Pressable style={[brutal.bigBtn, { backgroundColor: B.red }]} onPress={() => Alert.alert("SIGN OUT?", "Token will be removed.", [{ text: "CANCEL" }, { text: "SIGN OUT", onPress: signOut }])}>
        <Text style={[brutal.bigBtnText, { color: "#fff" }]}>SIGN OUT</Text>
      </Pressable>
    </View>
  );
}
