// Creates the app_db database if missing (no psql.exe in the embedded bundle).
import pg from "pg";

const host = process.env.PGHOST ?? "127.0.0.1";
const port = process.env.PGPORT ?? "5432";
const client = new pg.Client({ connectionString: `postgresql://postgres@${host}:${port}/postgres` });
await client.connect();
const { rows } = await client.query("select datname from pg_database where datname = 'app_db'");
if (rows.length === 0) {
  await client.query("create database app_db");
  console.log("app_db created");
} else {
  console.log("app_db already exists");
}
await client.end();
