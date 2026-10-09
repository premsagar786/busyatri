// BUSYATRI GPS simulator — replays a route to the backend without a phone.
// Usage:
//   API=http://localhost:3000 TOKEN=bt_xxx BUS_ID=1 node replay.js
//   API=https://bustracker-api.fly.dev TOKEN=bt_xxx TRIP=trip_demo_01 node replay.js --loop
import crypto from "node:crypto";

const API = process.env.API || "http://localhost:3000";
const TOKEN = process.env.TOKEN;
const TRIP = process.env.TRIP || `trip_${new Date().toISOString().slice(0,10).replace(/-/g,"")}_SIM_${Date.now().toString(36)}`;
const LOOP = process.argv.includes("--loop");
const INTERVAL = Number(process.env.EVERY || 3000);

if (!TOKEN) { console.error("Set TOKEN=bt_... (from backend seed output)"); process.exit(1); }

// Beas → Amritsar Group of Colleges, true road path (OSRM, downsampled).
// Ends at AGC gate (12 Km Stone, NH-3 GT Road, Meharbanpur).
const ROUTE = [
  [31.5166,75.2833],[31.5192,75.2856],[31.5241,75.2804],[31.5276,75.2711],[31.532,75.2578],[31.5414,75.2319],[31.543,75.2187],[31.548,75.1761],[31.5525,75.153],[31.555,75.1409],[31.5585,75.1242],[31.5611,75.111],[31.5636,75.0958],[31.5653,75.0755],[31.5671,75.0523],[31.5689,75.0328],[31.571,75.019],[31.5743,75.0064],[31.5803,74.9899],[31.59,74.9737],[31.5925,74.9771],[31.604,74.9756]
];

function interp(a, b, t) { return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]; }
const PTS = [];
for (let i = 0; i < ROUTE.length - 1; i++)
  for (let k = 0; k < 10; k++) PTS.push(interp(ROUTE[i], ROUTE[i+1], k / 10));
PTS.push(ROUTE.at(-1));

let seq = 0, idx = 0;
console.log(`[sim] API=${API} TRIP=${TRIP} pts=${PTS.length} every=${INTERVAL}ms loop=${LOOP}`);

async function tick() {
  const batch = [];
  for (let n = 0; n < 3 && idx < PTS.length; n++, idx++, seq++) {
    const jitter = () => (Math.random() - 0.5) * 0.001;
    batch.push({
      point_id: crypto.randomUUID(), seq,
      lat: PTS[idx][0] + jitter(), lng: PTS[idx][1] + jitter(),
      accuracy_m: 8 + Math.random() * 6, speed_mps: 8 + Math.random() * 4,
      recorded_at: new Date().toISOString(),
    });
  }
  if (!batch.length) {
    if (LOOP) { idx = 0; console.log("[sim] looping route…"); return; }
    console.log("[sim] done. End trip:");
    console.log(`curl -X POST ${API}/api/v1/buses/trips/${TRIP}/end -H "Authorization: Bearer $TOKEN"`);
    process.exit(0);
  }
  const res = await fetch(`${API}/api/v1/positions/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ trip_id: TRIP, source: "phone", points: batch }),
  });
  const j = await res.json();
  console.log(`[sim] seq~${seq} accepted=${j.accepted} dups=${j.duplicates} rej=${j.rejected?.length || 0}`);
}

await tick();
setInterval(tick, INTERVAL);
