import { StyleSheet } from "react-native";

// BRUTALISM THEME — single source of truth
export const B = {
  bg: "#F4F1EA",
  ink: "#111111",
  paper: "#FFFFFF",
  yellow: "#FFDE00",
  pink: "#FF4D8D",
  lime: "#00E676",
  blue: "#2D7FF9",
  red: "#FF3B30",
  amber: "#FFAB00",
  border: 3,
};

export const brutal = StyleSheet.create({
  screen: { flex: 1, backgroundColor: B.bg, padding: 16 },
  headerBlock: {
    backgroundColor: B.ink, padding: 12, borderWidth: B.border, borderColor: B.ink,
    shadowColor: B.pink, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 0,
    elevation: 0, marginBottom: 14,
  },
  headerText: { color: "#fff", fontWeight: "900", fontSize: 26, letterSpacing: -0.5 },
  headerSub: { color: B.yellow, fontWeight: "800", fontSize: 12, marginTop: 2 },
  card: { backgroundColor: B.paper, borderWidth: B.border, borderColor: B.ink, padding: 14, marginBottom: 14 },
  cardHard: { backgroundColor: B.paper, borderWidth: B.border, borderColor: B.ink, padding: 14, marginBottom: 14, shadowColor: B.ink, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  label: { fontWeight: "900", fontSize: 12, letterSpacing: 1, marginBottom: 6 },
  input: { borderWidth: B.border, borderColor: B.ink, backgroundColor: "#fff", padding: 12, fontWeight: "700", fontSize: 16, marginBottom: 12 },
  bigBtn: { borderWidth: B.border, borderColor: B.ink, padding: 18, alignItems: "center", marginBottom: 12 },
  bigBtnText: { fontWeight: "900", fontSize: 22, letterSpacing: 0.5 },
  chip: { borderWidth: B.border, borderColor: B.ink, paddingHorizontal: 10, paddingVertical: 6, fontWeight: "900", fontSize: 13, overflow: "hidden" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { flex: 1, minWidth: 100, borderWidth: B.border, borderColor: B.ink, backgroundColor: "#fff", padding: 10 },
  statVal: { fontWeight: "900", fontSize: 20 },
  statKey: { fontWeight: "800", fontSize: 11, opacity: 0.7 },
});
