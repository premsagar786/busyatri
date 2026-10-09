import "dotenv/config";
import { getSqlite, isPg } from "./index";

// Dev-only cleanup of test rows (SQLite only; on Supabase use the SQL
// editor — same statements, minus the arrow-encoding headache).
async function main() {
  if (isPg) {
    console.error("clean.ts is SQLite-only. On Supabase, run equivalent DELETEs in the SQL editor.");
    process.exit(1);
  }
  const db = getSqlite();
  db.prepare("DELETE FROM positions WHERE bus_id NOT IN (SELECT id FROM buses WHERE bus_number IN ('BUS 01','BUS 02','BUS 03'))").run();
  db.prepare("DELETE FROM trips WHERE trip_code LIKE 'trip_e2e%' OR trip_code LIKE 'trip_sim%' OR trip_code LIKE 'trip_ws%' OR trip_code LIKE 'trip_demo%'").run();
  db.prepare("DELETE FROM buses WHERE bus_number NOT IN ('BUS 01','BUS 02','BUS 03')").run();
  db.prepare("DELETE FROM routes WHERE name NOT IN ('Amritsar → Campus','Beas → Campus','Jalandhar → Campus')").run();
  console.log("buses:", JSON.stringify(db.prepare("SELECT id,bus_number,route_id,route_name FROM buses ORDER BY bus_number").all()));
  console.log("routes:", JSON.stringify(db.prepare("SELECT id,name,origin FROM routes ORDER BY id").all()));
}

main().catch((err) => { console.error(err); process.exit(1); });
