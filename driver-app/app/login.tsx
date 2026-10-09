import { useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { B, brutal } from "../src/ui/theme";
import { saveSession } from "../src/queue/db";
import { useTrip } from "../src/store/tripStore";
import { fetchMyBus } from "../src/api/profile";
import { getApiUrl } from "../src/api/endpoint";

export default function Login() {
  const [bus, setBus] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const set = useTrip((s) => s.set);

  async function signIn() {
    const cleanToken = token.trim();
    if (!cleanToken) {
      Alert.alert("MISSING", "Enter the device token from admin — or scan the QR instead.");
      return;
    }
    setBusy(true);
    try {
      // Real verification: token must be accepted by the live backend.
      const api = await getApiUrl();
      const profile = await fetchMyBus(api, cleanToken);
      if (bus.trim() && profile.bus_number !== bus.trim().toUpperCase()) {
        Alert.alert("WRONG BUS", `This token belongs to ${profile.bus_number}.`);
        return;
      }
      await saveSession("busyatri_bus", profile.bus_number);
      await saveSession("busyatri_token", cleanToken);
      set({ busNumber: profile.bus_number, route: profile.route, destination: profile.destination, token: cleanToken });
      router.replace("/permissions");
    } catch (err) {
      Alert.alert("SIGN IN FAILED", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={brutal.screen}>
      <View style={brutal.headerBlock}>
        <Text style={brutal.headerText}>BUS★YATRI</Text>
        <Text style={brutal.headerSub}>DRIVER LOGIN / SCAN OR TYPE</Text>
      </View>
      <Pressable style={[brutal.bigBtn, { backgroundColor: B.lime }]} onPress={() => router.push("/scan")}>
        <Text style={brutal.bigBtnText}>▣ SCAN BUS QR →</Text>
      </Pressable>
      <View style={brutal.cardHard}>
        <Text style={brutal.label}>BUS NUMBER (OPTIONAL CHECK)</Text>
        <TextInput style={brutal.input} value={bus} onChangeText={setBus} placeholder="BUS 01" autoCapitalize="characters" editable={!busy} />
        <Text style={brutal.label}>DEVICE TOKEN</Text>
        <TextInput style={brutal.input} value={token} onChangeText={setToken} placeholder="bt_..." secureTextEntry editable={!busy} />
        <Pressable style={[brutal.bigBtn, { backgroundColor: B.yellow, opacity: busy ? 0.6 : 1 }]} onPress={signIn} disabled={busy}>
          {busy ? <ActivityIndicator size="large" color="#111" /> : <Text style={brutal.bigBtnText}>VERIFY + SIGN IN →</Text>}
        </Pressable>
        <Text style={{ fontWeight: "700", fontSize: 12 }}>TOKEN IS CHECKED LIVE. 401 = ASK ADMIN. QR SCAN SETS THE SERVER URL FOR YOU.</Text>
      </View>
    </View>
  );
}
