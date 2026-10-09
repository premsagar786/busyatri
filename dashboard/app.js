/* BUSYATRI dashboard — brutalist live client. 100% real API data, zero mocks. */
/* global QRCode */
const $ = (s) => document.querySelector(s);
const store = {
  get api() {
    const saved = localStorage.getItem("by_api");
    if (saved) return saved;
    // Same-origin backend (npm run dev serves us) → use it; static preview
    // on another port → assume backend on :3000; file:// → localhost.
    if (location.protocol.startsWith("http") && location.hostname) {
      if (location.port === "3000" || !location.port) return location.origin;
      return `${location.protocol}//${location.hostname}:3000`;
    }
    return "http://localhost:3000";
  },
  // Always derive WS from the API URL so the two can never disagree.
  get ws() { return localStorage.getItem("by_ws") || store.api.replace(/^http/, "ws") + "/ws/live"; },
};

// --- map ---
const map = L.map("map").setView([31.05, 75.55], 9);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap",
}).addTo(map);

const markers = new Map();  // busNumber -> marker
const trails = new Map();   // busNumber -> trail polyline
const routeLines = [];      // route polylines from /api/v1/routes
const firstSeen = new Map();// busNumber -> timestamp (NEW-bus spotlight)
let buses = [];
let routes = [];
let selected = null;
let lastHeartbeat = 0;

const PALETTE = ["#ff4d8d", "#2d7ff9", "#00e676", "#ffab00", "#b388ff"];

function markerFor(b) {
  const pos = b.last_position;
  if (!pos) return;
  const html = `<div class="bus-marker">${escapeHtml(b.bus_number)} ● ${b.status.toUpperCase()}</div>`;
  const icon = L.divIcon({ html, className: "", iconSize: [140, 30] });
  if (markers.has(b.bus_number)) {
    markers.get(b.bus_number).setLatLng([pos.lat, pos.lng]).setIcon(icon);
  } else {
    markers.set(b.bus_number, L.marker([pos.lat, pos.lng], { icon }).addTo(map)
      .bindPopup(`<b>${escapeHtml(b.bus_number)}</b><br>${escapeHtml(b.route || "")} → ${escapeHtml(b.destination || "")}<br>${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`));
  }
}

async function fetchRoutes() {
  try {
    const r = await fetch(store.api + "/api/v1/routes");
    if (!r.ok) throw new Error("http " + r.status);
    routes = await r.json();
    drawRoutes();
    buildTicker();
  } catch (e) {
    console.warn("[routes]", e.message);
  }
}

function drawRoutes() {
  for (const l of routeLines) map.removeLayer(l);
  routeLines.length = 0;
  routes.forEach((rt, i) => {
    if (!rt.polyline || rt.polyline.length < 2) return;
    const color = PALETTE[i % PALETTE.length];
    routeLines.push(L.polyline(rt.polyline, { color: "#111", weight: 9 }).addTo(map).bringToBack());
    routeLines.push(L.polyline(rt.polyline, { color, weight: 5 }).addTo(map)
      .bindTooltip(`<b>${escapeHtml(rt.name)}</b>`, { sticky: true }));
  });
}

function buildTicker() {
  const names = routes.length ? routes.map((r) => r.name.toUpperCase()) : buses.map((b) => b.bus_number);
  const runs = buses.filter((b) => b.status !== "Offline").length;
  const text = names.length
    ? `● LIVE: ${runs}/${buses.length} BUSES ` + names.map((n) => `● ${escapeHtml(n)}`).join(" ") + " ● GPS 10s ● OFFLINE QUEUE ON ●&nbsp;"
    : "● NO ROUTES YET — SEED THE BACKEND ●&nbsp;";
  $("#ticker").innerHTML = `<span>${text}</span><span>${text}</span>`;
}

async function fetchBuses() {
  try {
    const r = await fetch(store.api + "/api/v1/buses");
    if (!r.ok) throw new Error("http " + r.status);
    buses = await r.json();
    // drop markers for buses that no longer exist
    const alive = new Set(buses.map((b) => b.bus_number));
    for (const [k, m] of markers) if (!alive.has(k)) { map.removeLayer(m); markers.delete(k); }
    setConn(true);
    render();
    buildTicker();
    $("#footStatus").textContent = "LAST SERVER UPDATE: " + new Date().toLocaleTimeString();
  } catch (e) {
    setConn(false);
    $("#mapFoot").textContent = "API UNREACHABLE @ " + store.api + " — CHECK ⚙ API";
  }
}

async function fetchTrail(bus) {
  try {
    const r = await fetch(store.api + `/api/v1/buses/${bus.id}/trail`);
    const j = await r.json();
    const latlngs = (j.trail || []).map((p) => [p.lat, p.lng]);
    if (trails.has(bus.bus_number)) map.removeLayer(trails.get(bus.bus_number));
    if (latlngs.length) {
      L.polyline(latlngs, { color: "#111", weight: 10 }).addTo(map);
      const line = L.polyline(latlngs, { color: "#ffde00", weight: 5 }).addTo(map);
      line.bringToFront(); // live trail always above route layers
      trails.set(bus.bus_number, line);
      map.fitBounds(line.getBounds().pad(0.2));
      $("#mapFoot").textContent = `${bus.bus_number} TRAIL: ${j.count} PTS`;
    } else {
      $("#mapFoot").textContent = `${bus.bus_number}: NO TRAIL YET`;
    }
  } catch (e) { console.warn(e); }
}

async function fetchHistory(bus, box) {
  box.textContent = "LOADING HISTORY…";
  try {
    const r = await fetch(store.api + `/api/v1/buses/${bus.id}/trips`);
    const trips = await r.json();
    if (!trips.length) { box.textContent = "NO TRIPS YET FOR THIS BUS."; return; }
    box.innerHTML = trips.slice(0, 8).map((t) =>
      `<div>▸ <b>${escapeHtml(t.trip_code)}</b> ${t.active ? "[ACTIVE]" : "[ENDED]"} ${(t.distance_m / 1000).toFixed(2)}km ${t.points_count}pts<br><span class="dim">${escapeHtml(t.started_at || "")}</span></div>`
    ).join("");
  } catch { box.textContent = "HISTORY FAILED."; }
}

function render() {
  $("#fleetCount").textContent = buses.length + " BUSES";
  const wrap = $("#cards");
  wrap.innerHTML = "";
  if (!buses.length) {
    wrap.innerHTML = `<div class="empty">NO BUSES IN FLEET.<br>ADD ONE VIA ADMIN BELOW ↓<br><span class="dim">OR RUN: npm run seed (backend)</span></div>`;
  }
  let live = 0;
  for (const b of buses) {
    if (b.status !== "Offline") live++;
    if (!firstSeen.has(b.bus_number)) firstSeen.set(b.bus_number, Date.now());
    const isNew = Date.now() - firstSeen.get(b.bus_number) < 60_000;
    if (b.last_position) markerFor(b);
    const el = document.createElement("div");
    el.className = "card" + (selected === b.bus_number ? " sel" : "");
    el.dataset.bus = b.bus_number;
    const ago = b.last_seen ? agoStr(b.last_seen) : "NEVER";
    const spd = b.last_position?.speed_mps != null ? `SPD: <b>${(b.last_position.speed_mps * 3.6).toFixed(1)} km/h</b>` : "";
    el.innerHTML = `
      <div class="card-top"><div class="busno ${b.status === "Offline" ? "" : "hot"}">${escapeHtml(b.bus_number)}${isNew ? '<span class="newtag">NEW</span>' : ""}</div>
      <div class="status ${b.status}">${b.status.toUpperCase()}</div></div>
      <div class="card-body">
        <div>ROUTE: <b>${escapeHtml(b.route || "—")}</b> → <b>${escapeHtml(b.destination || "—")}</b></div>
        <div>POS: <b class="js-pos">${b.last_position ? b.last_position.lat.toFixed(5) + ", " + b.last_position.lng.toFixed(5) : "NO FIX"}</b></div>
        <div>UPDATED: <b class="js-ago">${ago}</b> <span class="js-spd">${spd}</span></div>
        <div class="rowbtns"><button class="btn small ghost hist">HISTORY</button><button class="btn small ghost qrbtn">QR</button></div>
        <div class="histbox mono"></div>
      </div>`;
    el.querySelector(".card-top").onclick = () => {
      selected = b.bus_number;
      render();
      if (b.last_position) map.setView([b.last_position.lat, b.last_position.lng], 13);
      fetchTrail(b);
    };
    el.querySelector(".hist").onclick = (ev) => {
      ev.stopPropagation();
      fetchHistory(b, el.querySelector(".histbox"));
    };
    el.querySelector(".qrbtn").onclick = (ev) => {
      ev.stopPropagation();
      reissueQr(b);
    };
    wrap.appendChild(el);
  }
  $("#mapFoot").textContent = `${live} LIVE / ${buses.length} TOTAL — ${new Date().toLocaleTimeString()}`;
}

// Instant in-place patch from a live WS ping — no refetch. Marker glides,
// card fields update, footer stamps. The 10 s REST poll stays as reconciler.
function applyLivePosition(msg) {
  const b = buses.find((x) => x.bus_number === msg.bus_number);
  if (!b) { fetchBuses(); return; } // unknown (just created?) → full refresh
  b.last_position = { lat: msg.lat, lng: msg.lng, speed_mps: msg.speed_mps, recorded_at: msg.recorded_at, trip_id: msg.trip_id };
  b.last_seen = msg.recorded_at;
  if (msg.route) b.route = msg.route;
  if (msg.destination) b.destination = msg.destination;
  b.status = msg.speed_mps != null && msg.speed_mps <= 1.5 ? "Stopped" : "Moving";
  markerFor(b);
  patchCard(b);
  const live = buses.filter((x) => x.status !== "Offline").length;
  $("#mapFoot").textContent = `${msg.bus_number} ● LIVE ${new Date(msg.recorded_at).toLocaleTimeString()} — ${live} LIVE / ${buses.length} TOTAL`;
  $("#footStatus").textContent = "LAST SERVER UPDATE: " + new Date().toLocaleTimeString();
  setConn(true);
}

function patchCard(b) {
  const el = document.querySelector(`.card[data-bus="${CSS.escape(b.bus_number)}"]`);
  if (!el) { render(); return; }
  const chip = el.querySelector(".status");
  chip.className = "status " + b.status;
  chip.textContent = b.status.toUpperCase();
  el.querySelector(".busno").classList.toggle("hot", b.status !== "Offline");
  if (b.last_position) {
    el.querySelector(".js-pos").textContent = `${b.last_position.lat.toFixed(5)}, ${b.last_position.lng.toFixed(5)}`;
    el.querySelector(".js-spd").innerHTML = b.last_position.speed_mps != null
      ? `SPD: <b>${(b.last_position.speed_mps * 3.6).toFixed(1)} km/h</b>` : "";
  }
  el.querySelector(".js-ago").textContent = b.last_seen ? agoStr(b.last_seen) : "NEVER";
}

let toastTimer = null;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 6000);
}

// --- driver QR: payload the app scans to sign in (api + bus + token) ---
function showQr(busNumber, token) {
  const text = JSON.stringify({ v: 1, api: store.api, bus: busNumber, token });
  $("#qrTitle").textContent = busNumber + " — SCAN TO DRIVE";
  $("#qrMeta").textContent = `SERVER: ${store.api} / PRINT + STICK IN THE BUS`;
  const box = $("#qrBox");
  box.innerHTML = "";
  try {
    new QRCode(box, { text, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  } catch (e) {
    box.textContent = "QR LIB FAILED TO LOAD (CHECK NETWORK). TOKEN: " + token;
  }
  $("#qrModal").classList.remove("hidden");
}
$("#qrClose").onclick = () => $("#qrModal").classList.add("hidden");
$("#qrPrint").onclick = () => window.print();

// Reissue = rotate token, then show QR. Old token dies: the driver's app
// must scan the new code (or type the new token) to keep driving.
async function reissueQr(bus) {
  if (!confirm(`REISSUE QR for ${bus.bus_number}?\nOld token stops working — driver re-signs with the new code.`)) return;
  const key = prompt("X-ADMIN-KEY:") || "";
  if (!key) return;
  try {
    const r = await fetch(store.api + `/api/v1/buses/${encodeURIComponent(bus.bus_number)}/rotate-token`, {
      method: "POST", headers: { "x-admin-key": key },
    });
    const j = await r.json();
    if (!r.ok) { alert("FAIL: " + JSON.stringify(j)); return; }
    $("#adminOut").textContent = `REISSUED → ${j.bus_number}\nNEW TOKEN → ${j.token}`;
    showQr(j.bus_number, j.token);
  } catch (err) { alert("ERR → " + err.message); }
}

$("#fitBtn").onclick = () => {
  const pts = buses.filter((b) => b.last_position).map((b) => [b.last_position.lat, b.last_position.lng]);
  for (const rt of routes) if (rt.polyline?.length) pts.push(...rt.polyline);
  if (pts.length) map.fitBounds(pts.length === 1 ? [pts[0], pts[0]] : pts, { padding: [30, 30] });
};
$("#refreshBtn").onclick = () => { fetchRoutes(); fetchBuses(); };

function agoStr(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return s + "s AGO";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m AGO";
  return Math.floor(m / 60) + "h AGO";
}
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function setConn(ok) {
  const el = $("#conn");
  const wsStale = lastHeartbeat && Date.now() - lastHeartbeat > 30_000;
  if (!ok || wsStale) { el.className = "conn offline"; el.textContent = "● OFFLINE"; }
  else { el.className = "conn online"; el.textContent = "● ONLINE"; }
}

// --- websocket ---
let ws;
function connectWs() {
  try { if (ws) ws.close(); } catch {}
  try {
    ws = new WebSocket(store.ws);
    ws.onopen = () => { lastHeartbeat = Date.now(); setConn(true); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "heartbeat" || msg.type === "hello") { lastHeartbeat = Date.now(); setConn(true); $("#serverTime").textContent = new Date().toLocaleTimeString(); return; }
        if (msg.type === "bus.position") { lastHeartbeat = Date.now(); applyLivePosition(msg); return; }
        if (msg.type === "bus.created") {
          lastHeartbeat = Date.now();
          firstSeen.set(msg.bus_number, Date.now());
          toast(`+ NEW BUS ${msg.bus_number} — ${msg.route || "no route"} (TOKEN ISSUED)`);
          fetchRoutes(); fetchBuses();
          return;
        }
        if (msg.type === "bus.status" || msg.type === "trip.end") { fetchBuses(); return; }
        if (msg.type === "routes.updated") { fetchRoutes(); fetchBuses(); return; }
      } catch {}
    };
    ws.onclose = () => { setConn(false); setTimeout(connectWs, 4000); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  } catch { setTimeout(connectWs, 4000); }
}

// --- admin ---
// "lat,lng | lat,lng | …" → [[lat,lng],…] or undefined (field left empty)
function parsePolyline(text) {
  const t = (text || "").trim();
  if (!t) return undefined;
  const pts = t.split("|").map((pair) => pair.split(",").map(Number));
  if (pts.length < 2 || pts.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) {
    throw new Error("POLYLINE FORMAT: lat,lng | lat,lng (at least 2 points)");
  }
  for (const [lat, lng] of pts) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error("POLYLINE OUT OF RANGE");
  }
  return pts;
}

$("#addBus").onsubmit = async (e) => {
  e.preventDefault();
  const out = $("#adminOut");
  out.textContent = "SENDING…";
  const key = $("#fKey").value.trim();
  if (!key) { out.textContent = "ERR → ENTER THE X-ADMIN-KEY FIRST."; return; }
  try {
    const body = {
      bus_number: $("#fBus").value.trim(),
      route_name: $("#fRoute").value.trim(),
      origin: $("#fOrigin").value.trim(),
      destination: $("#fDest").value.trim(),
      polyline: parsePolyline($("#fPoly").value),
    };
    const r = await fetch(store.api + "/api/v1/buses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    out.textContent = r.ok
      ? `OK → ${j.bus_number}\nTOKEN → ${j.token}\nROUTE → ${j.route_created ? "CREATED NEW" : "LINKED EXISTING"} (id ${j.route_id})\n(GIVE TOKEN TO DRIVER, SHOWS ONCE)`
      : `FAIL ${r.status} → ${JSON.stringify(j)}`;
    const wrap = $("#qrWrap");
    wrap.innerHTML = "";
    if (r.ok) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "▣ SHOW QR FOR THIS TOKEN";
      btn.onclick = () => showQr(j.bus_number, j.token);
      wrap.appendChild(btn);
      fetchRoutes(); fetchBuses();
    }
  } catch (err) { out.textContent = "ERR → " + err.message; }
};

// --- config modal ---
const modal = $("#cfgModal");
$("#cfgBtn").onclick = () => { $("#apiUrl").value = store.api; $("#wsUrl").value = store.ws; modal.classList.remove("hidden"); };
$("#cfgClose").onclick = () => modal.classList.add("hidden");
$("#cfgSave").onclick = () => {
  localStorage.setItem("by_api", $("#apiUrl").value.trim());
  localStorage.setItem("by_ws", $("#wsUrl").value.trim());
  modal.classList.add("hidden");
  connectWs(); fetchRoutes(); fetchBuses();
};

setInterval(() => {
  if (lastHeartbeat && Date.now() - lastHeartbeat > 30_000) setConn(false);
  render();
}, 15_000);

connectWs();
fetchRoutes();
fetchBuses();
setInterval(fetchBuses, 10_000);
setInterval(fetchRoutes, 60_000);
