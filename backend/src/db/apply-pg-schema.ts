// One-off: apply schema.pg.sql to Supabase via DIRECT_URL (session mode).
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL not set");
  const sql = postgres(url, { prepare: false });
  const schema = fs.readFileSync(path.join(__dirname, "schema.pg.sql"), "utf8");
  await sql.unsafe(schema);
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  console.log("TABLES:", tables.map((t) => t.tablename).join(","));
  await sql.end();
}
main().catch((e) => { console.error("SCHEMA_FAIL", e.message); process.exit(1); });
