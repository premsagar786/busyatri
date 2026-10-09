/* BUSYATRI DRIVER WEB — QR login, GPS tracking, offline queue. No build step. */
/* global Html5Qrcode */
"use strict";
const $ = (s) => document.querySelector(s);

// ---------- storage ----------
const LS = {
  get bus() { return localStorage.getItem("dw_bus"); },
  get token() { return localStorage.getItem("dw_token"); },
  get api() { return localStorage.getItem("dw_api") || defaultApi(); },
  get trip() { try { return JSON.parse(localStorage.getItem("dw_trip") || "null"); } catch { return null; } },
  get queue() { try { return JSON.parse(localStorage.getItem("dw_queue") || "[]"); } catch { return []; } },
  get seq() { return Number(localStorage.getItem("dw_seq") || 0); },
  set(key, val) { val === null ? localStorage.removeItem(key) : localStorage.setItem(key, val); },
};
function defaultApi() {
  // Same-origin backend serves us in local dev; tunnel/prod URL comes from QR.
  if (location.protocol.startsWith("http") && location.hostname) {
    if (location.port === "3000" || !location.port) return location.origin;
    return `${location.protocol}//${location.hostname}:3000`;
  }
  return "http://localhost:3000";
}
function saveQueue(q) { LS.set("dw_queue", JSON.stringify(q.slice(-10000))); } // cap 10k, drop oldest synced-risk none: oldest first
function securePage() { return window.isSecureContext; }

// ---------- state ----------
const S = {
  trip: LS.trip, online: navigator.onLine !== false,
  watchId: null, wakeLock: null, lastFix: 0, lastEnqueue: 0,
  speed: null, accuracy: null, lastSync: null, syncFail: 0, syncing: false,
  sent: Number(localStorage.getItem("dw_sent") || 0),
};

// ---------- views ----------
function show(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
  window.scrollTo(0, 0);
}

// ---------- QR payload (mirrors driver-app/src/api/qr.ts) ----------
function parseQr(raw) {
  let j;
  try { j = JSON.parse(raw); } catch { throw new Error("Not a BusYatri QR — scan the admin's bus code."); }
  if (!j || typeof j !== "object" || j.v !== 1) throw new Error("Unknown QR version — ask admin to reprint it.");
  const api = String(j.api || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/i.test(api)) throw new Error("QR has a bad server address.");
  const token = String(j.token || "").trim();
  if (!token) throw new Error("QR has no token — ask admin to reprint it.");
  return { v: 1, api, bus: String(j.bus || "").trim().toUpperCase(), token };
}

function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* insecure context */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------- api ----------
async function apiFetch(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const headers = Object.assign({}, opts.headers || {});
    if (LS.token) headers.Authorization = "Bearer " + LS.token;
    const r = await fetch(LS.api + path, Object.assign({}, opts, { headers, signal: ctrl.signal }));
    return r;
  } finally { clearTimeout(t); }
}
async function verifyToken(api, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(api + "/api/v1/buses/me", { headers: { Authorization: "Bearer " + token }, signal: ctrl.signal });
    if (r.status === 401) throw new Error("Token invalid — ask admin for a new one.");
    if (!r.ok) throw new Error("Server error " + r.status);
    return r.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Server unreachable — check network / URL.");
    throw e;
  } finally { clearTimeout(t); }
}

// ---------- login ----------
function fail(msg) { const e = $("#loginErr"); e.textContent = msg; e.classList.remove("hidden"); }
async function signInWith(bus, token, api) {
  const profile = await verifyToken(api, token);
  if (bus && profile.bus_number !== bus.toUpperCase()) throw new Error(`This token belongs to ${profile.bus_number}.`);
  LS.set("dw_bus", profile.bus_number); LS.set("dw_token", token); LS.set("dw_api", api);
  localStorage.setItem("dw_route", profile.route || "");
  localStorage.setItem("dw_dest", profile.destination || "");
  enterHome(); show("#v-perm"); // fresh sign-in always passes the explainer
}
$("#loginBtn").onclick = async () => {
  $("#loginErr").classList.add("hidden");
  const token = $("#fToken").value.trim();
  if (!token) return fail("Enter the token — or scan the QR instead.");
  try { await signInWith($("#fBus").value.trim(), token, LS.api); }
  catch (e) { fail(e.message); }
};
$("#srvBtn").onclick = () => {
  const v = prompt("SERVER URL (https tunnel for road use):", LS.api);
  if (v && v.trim()) { LS.set("dw_api", v.trim().replace(/\/+$/, "")); paintServer(); }
};
function paintServer() { $("#srvLbl").textContent = LS.api; }

// ---------- QR scan ----------
let scanner = null;
$("#scanBtn").onclick = async () => {
  if (!securePage()) return fail("Camera needs HTTPS — open the https:// tunnel link, then scan.");
  $("#scanBox").classList.remove("hidden");
  $("#scanBtn").classList.add("hidden");
  try {
    scanner = new Html5Qrcode("qrReader");
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 },
      async (text) => {
        try { await scanner.stop(); } catch { /* noop */ }
        $("#scanBox").classList.add("hidden"); $("#scanBtn").classList.remove("hidden");
        try {
          const qr = parseQr(text);
          await signInWith(qr.bus, qr.token, qr.api);
        } catch (e) { fail(e.message); }
      }, () => {});
  } catch (e) { fail("Camera blocked: " + e.message); }
};
$("#scanCancel").onclick = async () => {
  try { if (scanner) await scanner.stop(); } catch { /* noop */ }
  $("#scanBox").classList.add("hidden"); $("#scanBtn").classList.remove("hidden");
};

// ---------- home ----------
function enterHome() {
  $("#hBus").textContent = LS.bus || "BUS─?";
  $("#hRoute").textContent = `${localStorage.getItem("dw_route") || "—"} → ${localStorage.getItem("dw_dest") || "—"}`;
  const t = LS.trip;
  S.trip = t;
  if (t && !t.ended) {
    $("#resumeId").textContent = t.tripId;
    $("#resumeBox").classList.remove("hidden");
  } else $("#resumeBox").classList.add("hidden");
  paintHome();
  show("#v-home");
}
function statusChip() {
  const q = LS.queue.length;
  const el = $("#chip");
  if (!S.online) { el.className = "chip offline"; el.textContent = `OFFLINE ● ${q} QUEUED`; }
  else if (q > 0 || S.syncing) { el.className = "chip sync"; el.textContent = `SYNCING ● ${q}`; }
  else { el.className = "chip online"; el.textContent = S.trip ? "ONLINE ● LIVE" : "ONLINE"; }
}
function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 5) return "just now"; if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60); return m < 60 ? m + "m ago" : Math.floor(m / 60) + "h ago";
}
function kmh(mps) { return mps == null ? "—" : (mps * 3.6).toFixed(1) + " km/h"; }
function paintHome() {
  statusChip();
  $("#syncLine").textContent = `LAST SYNC: ${ago(S.lastSync)} / SENT: ${S.sent} / QUEUED: ${LS.queue.length}`;
  $("#stSpeed").textContent = kmh(S.speed);
  $("#stAcc").textContent = S.accuracy != null ? S.accuracy.toFixed(0) + "m" : "—";
  const btn = $("#tripBtn");
  if (S.trip) { btn.textContent = "■ END TRIP"; btn.className = "bigbtn red"; }
  else { btn.textContent = "▶ START TRIP"; btn.className = "bigbtn lime"; }
}
$("#resumeYes").onclick = () => { S.trip = LS.trip; $("#resumeBox").classList.add("hidden"); startTracking(); paintHome(); };
$("#resumeNo").onclick = () => { LS.set("dw_trip", null); S.trip = null; $("#resumeBox").classList.add("hidden"); paintHome(); };

// ---------- tracking ----------
function newTripId(bus) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `trip_${d}_${String(bus || "BUS").replace(/\s+/g, "")}_${Date.now().toString(36)}`;
}
async function holdWake() {
  try { if ("wakeLock" in navigator) S.wakeLock = await navigator.wakeLock.request("screen"); } catch { /* noop */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.trip) holdWake();
});
function onFix(pos) {
  S.lastFix = Date.now();
  const c = pos.coords;
  S.speed = c.speed; S.accuracy = c.accuracy;
  if (!S.trip) return;
  if (Date.now() - S.lastEnqueue < 8000) return; // ~10 s cadence
  S.lastEnqueue = Date.now();
  const seq = LS.seq + 1;
  localStorage.setItem("dw_seq", String(seq));
  const q = LS.queue;
  q.push({
    point_id: uuid(), seq, lat: c.latitude, lng: c.longitude,
    accuracy_m: c.accuracy ?? null, speed_mps: c.speed ?? null,
    recorded_at: new Date(pos.timestamp).toISOString(),
  });
  saveQueue(q);
  paintHome(); paintTrip();
  void syncNow();
}
function onFixErr(e) {
  const m = { 1: "GPS denied — allow location for this site.", 2: "No GPS fix — go outside / near a window.", 3: "GPS timed out — retrying." }[e.code] || "GPS error.";
  $("#permErr").textContent = m; $("#permErr").classList.remove("hidden");
}
function startTracking() {
  if (!("geolocation" in navigator)) { alert("This browser has no GPS."); return; }
  try {
    S.watchId = navigator.geolocation.watchPosition(onFix, onFixErr,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  } catch (e) { alert("GPS failed: " + e.message); return; }
  void holdWake();
  void syncNow();
}
function stopTracking() {
  if (S.watchId != null) { try { navigator.geolocation.clearWatch(S.watchId); } catch { /* noop */ } S.watchId = null; }
  try { if (S.wakeLock) S.wakeLock.release(); } catch { /* noop */ } S.wakeLock = null;
}
$("#tripBtn").onclick = async () => {
  if (!S.trip) {
    if (!securePage()) { alert("GPS needs HTTPS — open the https:// tunnel link."); return; }
    const tripId = newTripId(LS.bus);
    S.trip = { tripId, startedAt: new Date().toISOString() };
    LS.set("dw_trip", JSON.stringify(S.trip));
    S.sent = 0; localStorage.setItem("dw_sent", "0");
    startTracking();
    $("#tId").textContent = tripId;
    paintHome(); show("#v-trip"); paintTrip();
  } else {
    await endTrip();
  }
};
async function endTrip() {
  // flush first: up to 3 immediate attempts, rest stays queued (never dropped)
  for (let i = 0; i < 3 && LS.queue.length; i++) await syncNow();
  try {
    await apiFetch(`/api/v1/buses/trips/${encodeURIComponent(S.trip.tripId)}/end`, { method: "POST" });
  } catch (e) { console.warn("end-trip ping failed (data is safe):", e.message); }
  stopTracking();
  const dur = Date.now() - Date.parse(S.trip.startedAt);
  const m = Math.floor(dur / 60000), s = Math.floor((dur % 60000) / 1000);
  $("#sId").textContent = S.trip.tripId;
  $("#sBody").innerHTML = `POINTS SENT: ${S.sent}<br>STILL QUEUED: ${LS.queue.length} (WILL UPLOAD)<br>DURATION: ${m}m ${s}s`;
  S.trip = null; LS.set("dw_trip", null);
  paintHome(); show("#v-summary");
}

// ---------- sync (batch, backoff, never drop unsent) ----------
function backoff(attempt, base = 2000, cap = 60000) {
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.round(exp * (0.7 + Math.random() * 0.6));
}
async function syncNow() {
  if (S.syncing || !S.trip || !S.online) return;
  const q = LS.queue;
  if (!q.length) return;
  S.syncing = true; paintHome();
  try {
    const batch = q.slice(0, 50).map((p) => ({
      point_id: p.point_id, seq: p.seq, lat: p.lat, lng: p.lng,
      accuracy_m: p.accuracy_m, speed_mps: p.speed_mps, recorded_at: p.recorded_at,
    }));
    const r = await apiFetch("/api/v1/positions/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trip_id: S.trip.tripId, source: "phone", points: batch }),
    });
    if (r.status === 401) throw new Error("Token invalid, ask admin");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const ids = new Set(batch.map((p) => p.point_id));
    saveQueue(LS.queue.filter((p) => !ids.has(p.point_id)));
    S.sent += batch.length; localStorage.setItem("dw_sent", String(S.sent));
    S.lastSync = new Date().toISOString(); S.syncFail = 0;
  } catch (e) {
    S.syncFail++;
    console.warn("sync failed, backoff:", e.message);
    await new Promise((r) => setTimeout(r, backoff(S.syncFail)));
  } finally {
    S.syncing = false; paintHome(); paintTrip();
    if (LS.queue.length && S.online && S.trip) setTimeout(syncNow, 500); // drain
  }
}
setInterval(() => { if (S.trip && S.online && LS.queue.length && !S.syncing) void syncNow(); }, 2500);
window.addEventListener("online", () => { S.online = true; paintHome(); void syncNow(); });
window.addEventListener("offline", () => { S.online = false; paintHome(); paintTrip(); });

// ---------- trip view / nav ----------
function paintTrip() {
  if (!S.trip) return;
  const el = Date.now() - Date.parse(S.trip.startedAt);
  const m = Math.floor(el / 60000), s = Math.floor((el % 60000) / 1000);
  $("#tElapsed").textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
  $("#tSpeed").textContent = kmh(S.speed);
  $("#tQueued").textContent = LS.queue.length;
  $("#tSent").textContent = S.sent;
  $("#tSync").textContent = `LAST: ${ago(S.lastSync)} / NET: ${S.online ? "ONLINE" : "OFFLINE"}`;
}
setInterval(() => { if (!$("#v-trip").classList.contains("hidden")) paintTrip(); if (!$("#v-home").classList.contains("hidden")) paintHome(); }, 3000);
$("#goTrip").onclick = () => { if (S.trip) { $("#tId").textContent = S.trip.tripId; paintTrip(); show("#v-trip"); } };
$("#backHome").onclick = () => { paintHome(); show("#v-home"); };
$("#sumHome").onclick = () => { paintHome(); show("#v-home"); };
$("#goSettings").onclick = () => { $("#setApi").textContent = LS.api; show("#v-settings"); };
$("#setBack").onclick = () => { paintHome(); show("#v-home"); };
$("#chgSrv").onclick = () => {
  const v = prompt("SERVER URL (https tunnel for road use):", LS.api);
  if (v && v.trim()) { LS.set("dw_api", v.trim().replace(/\/+$/, "")); $("#setApi").textContent = LS.api; }
};
$("#signOut").onclick = () => {
  if (!confirm("Sign out? Token removed from this phone.")) return;
  stopTracking();
  ["dw_bus", "dw_token", "dw_trip", "dw_queue", "dw_seq", "dw_sent", "dw_route", "dw_dest"].forEach((k) => LS.set(k, null));
  S.trip = null; S.sent = 0; S.lastSync = null;
  show("#v-login"); paintServer();
};

// ---------- permissions ----------
$("#permBtn").onclick = () => {
  $("#permErr").classList.add("hidden");
  if (!securePage()) {
    $("#permErr").textContent = "GPS needs HTTPS — open the https:// tunnel link.";
    $("#permErr").classList.remove("hidden");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    () => { paintHome(); show("#v-home"); },
    onFixErr,
    { enableHighAccuracy: true, timeout: 15000 }
  );
};

// ---------- boot ----------
paintServer();
if (!securePage() && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
  $("#secWarn").classList.remove("hidden");
}
if (!LS.bus || !LS.token) show("#v-login");
else enterHome(); // returning driver goes straight home (perm granted before)
