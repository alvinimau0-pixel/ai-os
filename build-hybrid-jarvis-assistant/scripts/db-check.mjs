import pg from "pg";

const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/app_db" });
await client.connect();
const reminders = await client.query("select id, label, kind, due_at, status from reminders order by id desc limit 5");
console.log("reminders:", JSON.stringify(reminders.rows, null, 1));
const wf = await client.query("select id, trigger, prompt, schedule, enabled from workflows order by id desc limit 5");
console.log("workflows:", JSON.stringify(wf.rows, null, 1));
const conv = await client.query("select id, title, oc_session_id from conversations order by id desc limit 3");
console.log("conversations:", JSON.stringify(conv.rows, null, 1));
await client.end();
