import { useState } from "react";
import { View, Text, Pressable, Alert, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { B, brutal } from "../src/ui/theme";
import { parseQrPayload } from "../src/api/qr";
import { setApiUrl } from "../src/api/endpoint";
import { fetchMyBus } from "../src/api/profile";
import { saveSession } from "../src/queue/db";
import { useTrip } from "../src/store/tripStore";

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const set = useTrip((s) => s.set);

  if (!permission) {
    return (
      <View style={brutal.screen}>
        <View style={brutal.headerBlock}>
          <Text style={brutal.headerText}>SCAN BUS QR</Text>
          <Text style={brutal.headerSub}>ASKING FOR CAMERA…</Text>
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={brutal.screen}>
        <View style={brutal.headerBlock}>
          <Text style={brutal.headerText}>SCAN BUS QR</Text>
          <Text style={brutal.headerSub}>CAMERA NEEDED FOR ONE SCAN</Text>
        </View>
        <View style={brutal.cardHard}>
          <Text style={{ fontWeight: "700", marginBottom: 12 }}>
            Point the camera at the QR the admin printed. It signs you in as
            your bus — no typing.
          </Text>
          <Pressable style={[brutal.bigBtn, { backgroundColor: B.yellow }]} onPress={requestPermission}>
            <Text style={brutal.bigBtnText}>ALLOW CAMERA →</Text>
          </Pressable>
          <Pressable style={[brutal.bigBtn, { backgroundColor: "#fff" }]} onPress={() => router.replace("/login")}>
            <Text style={{ fontWeight: "900" }}>TYPE TOKEN INSTEAD →</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  async function onScan(result: { data: string }) {
    if (locked) return;
    setLocked(true);
    try {
      const qr = parseQrPayload(result.data);
      await setApiUrl(qr.api);
      const profile = await fetchMyBus(qr.api, qr.token);
      if (qr.bus && profile.bus_number !== qr.bus) {
        throw new Error(`QR says ${qr.bus} but the server says ${profile.bus_number}. Reprint it.`);
      }
      await saveSession("busyatri_bus", profile.bus_number);
      await saveSession("busyatri_token", qr.token);
      set({ busNumber: profile.bus_number, route: profile.route, destination: profile.destination, token: qr.token });
      router.replace("/permissions");
    } catch (err) {
      Alert.alert("SCAN FAILED", err instanceof Error ? err.message : "Unknown error", [
        { text: "TYPE INSTEAD", onPress: () => router.replace("/login") },
        { text: "RETRY SCAN", onPress: () => setLocked(false) },
      ]);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: B.ink }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onScan}
      />
      <View style={styles.frame} pointerEvents="none">
        <View style={styles.corner} />
        <Text style={styles.hint}>HOLD THE BUS QR INSIDE THE FRAME</Text>
      </View>
      <Pressable style={styles.cancel} onPress={() => router.replace("/login")}>
        <Text style={styles.cancelText}>✕ CANCEL</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, alignItems: "center", justifyContent: "center" },
  corner: {
    width: 240, height: 240, borderWidth: 6, borderColor: "#FFDE00",
    backgroundColor: "transparent",
  },
  hint: {
    marginTop: 14, backgroundColor: "#111", color: "#FFDE00",
    fontWeight: "900", paddingHorizontal: 12, paddingVertical: 8,
  },
  cancel: {
    position: "absolute", bottom: 40, alignSelf: "center",
    backgroundColor: "#fff", borderWidth: 3, borderColor: "#111", padding: 12,
  },
  cancelText: { fontWeight: "900" },
});
