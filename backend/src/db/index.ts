import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { isPg } from "./pg";

export { isPg };

// SQLite stays the zero-config local default. When DATABASE_URL is set,
// routes use Postgres (Supabase) via src/db/store.ts and this file's `db`
// export is never created.
let sqlite: Database.Database | null = null;

function openSqlite(): Database.Database {
  const DB_PATH = process.env.DB_PATH || "./data/app.db";
  fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(__dirname, "schema.sql");
  if (fs.existsSync(schemaPath)) {
    db.exec(fs.readFileSync(schemaPath, "utf8"));
  } else {
    const alt = path.join(__dirname, "..", "db", "schema.sql");
    if (fs.existsSync(alt)) db.exec(fs.readFileSync(alt, "utf8"));
  }
  return db;
}

export function getSqlite(): Database.Database {
  if (isPg) throw new Error("SQLite handle requested but DATABASE_URL is set");
  if (!sqlite) sqlite = openSqlite();
  return sqlite;
}
