import "dotenv/config";
import { hashToken, makeToken } from "../auth/tokens";
import { upsertRoute, findBusByNumber, createBus, updateBusSeed } from "./store";

// Seed demo routes + buses. Prints tokens (save them into driver app / simulator).
// Campus = Amritsar Group of Colleges, 12 Km Stone, NH-3 GT Road, Meharbanpur.
// Route geometry = true road paths (OSRM over OpenStreetMap), downsampled.
// Re-running refreshes route polylines and rotates bus tokens (user buses untouched).

const AGC = "Amritsar Group of Colleges";

const ROUTES: Array<{ name: string; origin: string; destination: string; polyline: Array<[number, number]> }> = [
  {
    name: "Amritsar → Campus",
    origin: "Amritsar",
    destination: AGC,
    polyline: [[31.6331,74.8721],[31.6334,74.8738],[31.6336,74.8742],[31.6334,74.8755],[31.6308,74.8842],[31.6192,74.9061],[31.6168,74.9111],[31.6134,74.918],[31.6085,74.9278],[31.605,74.9347],[31.6042,74.9362],[31.6029,74.9388],[31.5994,74.946],[31.5974,74.9502],[31.5923,74.9604],[31.5893,74.9674],[31.5878,74.9727],[31.5901,74.9739],[31.5909,74.9762],[31.5927,74.9771],[31.5931,74.9763],[31.604,74.9756]],
  },
  {
    name: "Beas → Campus",
    origin: "Beas",
    destination: AGC,
    polyline: [[31.5166,75.2833],[31.5192,75.2856],[31.5241,75.2804],[31.5276,75.2711],[31.532,75.2578],[31.5414,75.2319],[31.543,75.2187],[31.548,75.1761],[31.5525,75.153],[31.555,75.1409],[31.5585,75.1242],[31.5611,75.111],[31.5636,75.0958],[31.5653,75.0755],[31.5671,75.0523],[31.5689,75.0328],[31.571,75.019],[31.5743,75.0064],[31.5803,74.9899],[31.59,74.9737],[31.5925,74.9771],[31.604,74.9756]],
  },
  {
    name: "Jalandhar → Campus",
    origin: "Jalandhar",
    destination: AGC,
    polyline: [[31.326,75.5762],[31.3271,75.5743],[31.3348,75.5691],[31.3534,75.5568],[31.3723,75.5447],[31.3866,75.5354],[31.4008,75.527],[31.424,75.5106],[31.4429,75.4899],[31.456,75.4528],[31.4683,75.4079],[31.4782,75.3796],[31.4946,75.344],[31.5147,75.2947],[31.529,75.266],[31.5419,75.2277],[31.5527,75.1521],[31.5603,75.1148],[31.566,75.0674],[31.5707,75.0202],[31.5847,74.9784],[31.604,74.9756]],
  },
];

const BUSES = [
  { bus_number: "BUS 01", route_name: "Amritsar → Campus", destination: AGC },
  { bus_number: "BUS 02", route_name: "Beas → Campus", destination: AGC },
  { bus_number: "BUS 03", route_name: "Jalandhar → Campus", destination: AGC },
];

async function main() {
  const routeIds = new Map<string, number>();
  for (const r of ROUTES) {
    // upsertRoute refreshes the polyline on re-seed — map layers always heal
    // to the proper road path; tolerant match prevents duplicates.
    const { id, created } = await upsertRoute({
      name: r.name, origin: r.origin, destination: r.destination,
      originExplicit: true, destExplicit: true, polyline: r.polyline,
    });
    routeIds.set(r.name, id);
    console.log(`${created ? "created" : "refreshed"} route ${r.name} (${r.polyline.length} pts)`);
  }

  console.log("=== BUS TOKENS (store securely, driver enters once) ===");
  for (const b of BUSES) {
    const token = makeToken();
    const h = hashToken(token);
    const routeId = routeIds.get(b.route_name) ?? null;
    const existing = await findBusByNumber(b.bus_number);
    if (existing) {
      await updateBusSeed(b.bus_number, { routeId, routeName: b.route_name, destination: b.destination, tokenHash: h });
    } else {
      await createBus({ busNumber: b.bus_number, routeId, routeName: b.route_name, destination: b.destination, tokenHash: h });
    }
    console.log(`${b.bus_number}  route=${b.route_name}  token=${token}`);
  }
  console.log("=== done ===");
}

main().catch((err) => { console.error(err); process.exit(1); });
