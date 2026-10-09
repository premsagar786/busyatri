import postgres from "postgres";

// Supabase (or any Postgres) via the Transaction Pooler URL:
//   DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
// `prepare: false` is required behind the pooler in transaction mode.
const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";

export const isPg = url.length > 0;

export const pgSql = isPg
  ? postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, prepare: false })
  : null;

export function requirePg() {
  if (!pgSql) throw new Error("DATABASE_URL is not set");
  return pgSql;
}
