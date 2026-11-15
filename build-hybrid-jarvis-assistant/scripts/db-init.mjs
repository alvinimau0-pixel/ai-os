// Applies scripts/db-schema.sql to the app database (idempotent).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, "db-schema.sql"), "utf8");

const host = process.env.PGHOST ?? "127.0.0.1";
const port = process.env.PGPORT ?? "5432";
const client = new pg.Client({ connectionString: `postgresql://postgres:postgres@${host}:${port}/app_db` });
await client.connect();
await client.query(sql);
console.log("schema applied");
const { rows } = await client.query(
  "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
);
console.log("tables:", rows.map((r) => r.table_name).join(", "));
await client.end();
