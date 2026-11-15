// Tool registry exposed to the cloud LLM (function calling). Every tool is backed by
// the same data layer the local skills use, so both brains share one source of truth.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { Priority, ReminderKind, ResourceKey, SettingsDTO } from "@/lib/types";
import type { ToolResult, ToolSpec } from "./llm";
import {
  addMemory,
  addNote,
  addReminder,
  addTask,
  bestMatch,
  cancelPendingByKind,
  deleteReminder,
  findOpenTask,
  forgetMemory,
  getStats,
  listNotes,
  listTasks,
  pendingReminders,
  searchNotes,
  updateSettings,
  updateTask,
  deleteTask,
} from "./data";
import { evaluate, formatNumber, normalizeMath } from "./math";
import { convertUnits, CURRENCY_ALIASES } from "./units";
import { convertCurrency, defineWord, describeWeather, fetchIcsEvents, firstSentences, getWeather, searchWeb, translateText, wikiLookup } from "./web";
import { fmtDate, fmtTime, fmtWhen, humanDuration, safeTz, zonedToUtc } from "./timeutil";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export interface ToolContext {
  tz: string;
  now: Date;
  settings: SettingsDTO;
  skillCount: number;
}

export async function collectStatus() {
  const t0 = performance.now();
  await db.execute(sql`select 1`);
  const dbMs = Math.max(1, Math.round(performance.now() - t0));
  const stats = await getStats();
  return {
    dbMs,
    stats,
    uptimeSec: Math.round(process.uptime()),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  };
}

/** Parse an ISO-ish datetime. With no offset it's interpreted in the user's timezone. */
export function parseLocalIso(value: string, tz: string): Date | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (m[6]) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 9, m[5] ? Number(m[5]) : 0, tz);
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

interface ToolDef {
  spec: ToolSpec;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

function def(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  run: ToolDef["run"],
): ToolDef {
  return {
    spec: { type: "function", function: { name, description, parameters: { type: "object", properties, required } } },
    run,
  };
}

const TOOLS: ToolDef[] = [
  def(
    "get_current_datetime",
    "Get the current date and time, optionally in another IANA timezone (e.g. Asia/Tokyo).",
    { timezone: { type: "string", description: "IANA timezone name. Defaults to the user's timezone." } },
    [],
    async (a, ctx) => {
      const tz = a.timezone ? safeTz(str(a.timezone)) : ctx.tz;
      return { output: `${fmtDate(ctx.now, tz)}, ${fmtTime(ctx.now, tz)} (${tz})`, summary: tz };
    },
  ),
  def(
    "get_weather",
    "Get current weather and a short forecast for a city. Uses the user's saved location when none is given.",
    {
      location: { type: "string", description: "City name, e.g. 'Paris'. Optional." },
      focus: { type: "string", enum: ["now", "tomorrow", "week"] },
    },
    [],
    async (a, ctx) => {
      const loc = str(a.location) || ctx.settings.location;
      if (!loc) return { output: "No location provided and none saved. Ask the user which city." };
      const w = await getWeather(loc, ctx.settings.units);
      const focus = a.focus === "tomorrow" || a.focus === "week" ? a.focus : "now";
      return { output: describeWeather(w, focus), summary: w.place };
    },
  ),
  def(
    "calculate",
    "Evaluate a mathematical expression precisely (supports + - * / ^ % sqrt sin cos log etc.).",
    { expression: { type: "string" } },
    ["expression"],
    async (a) => {
      const v = evaluate(normalizeMath(str(a.expression)));
      return v === null ? { output: "Could not evaluate that expression." } : { output: formatNumber(v), summary: formatNumber(v) };
    },
  ),
  def(
    "convert_units",
    "Convert between units of length, mass, volume, speed, area, time, data or temperature.",
    { value: { type: "number" }, from: { type: "string" }, to: { type: "string" } },
    ["value", "from", "to"],
    async (a) => {
      const r = convertUnits(num(a.value), str(a.from), str(a.to));
      if (!r) return { output: "Unknown unit." };
      if (r === "mismatch") return { output: "Those units measure different things and can't be converted." };
      const out = `${formatNumber(r.value)} ${r.from} = ${formatNumber(r.result)} ${r.to}`;
      return { output: out, summary: out };
    },
  ),
  def(
    "convert_currency",
    "Convert an amount between currencies using live exchange rates (ISO codes like USD, EUR).",
    { amount: { type: "number" }, from: { type: "string" }, to: { type: "string" } },
    ["amount", "from", "to"],
    async (a) => {
      const norm = (c: string) => CURRENCY_ALIASES[c.toLowerCase()] ?? c.toUpperCase();
      const from = norm(str(a.from));
      const to = norm(str(a.to));
      const r = await convertCurrency(num(a.amount), from, to);
      const out = `${formatNumber(num(a.amount))} ${from} = ${formatNumber(Math.round(r.result * 100) / 100)} ${to} (rate ${r.rate}, ${r.date})`;
      return { output: out, summary: `${from}→${to}` };
    },
  ),
  def(
    "add_task",
    "Add a task to the user's to-do list.",
    {
      title: { type: "string" },
      priority: { type: "string", enum: ["low", "normal", "high"] },
      due: { type: "string", description: "Optional due date/time as local ISO 'YYYY-MM-DDTHH:mm'." },
    },
    ["title"],
    async (a, ctx) => {
      const due = a.due ? parseLocalIso(str(a.due), ctx.tz) : null;
      const t = await addTask({ title: str(a.title), priority: (["low", "normal", "high"].includes(str(a.priority)) ? str(a.priority) : "normal") as Priority, dueAt: due });
      return { output: `Task #${t.id} added: "${t.title}"${due ? ` (due ${fmtWhen(due, ctx.now, ctx.tz)})` : ""}.`, refresh: ["tasks"], summary: t.title };
    },
  ),
  def(
    "list_tasks",
    "List the user's tasks.",
    { status: { type: "string", enum: ["open", "done", "all"] } },
    [],
    async (a, ctx) => {
      const all = await listTasks();
      const status = str(a.status) || "open";
      const items = all.filter((t) => (status === "all" ? true : status === "done" ? t.done : !t.done));
      if (!items.length) return { output: status === "done" ? "No completed tasks." : "No open tasks." };
      return {
        output: items
          .map((t, i) => `${i + 1}. ${t.title}${t.priority === "high" ? " [high priority]" : ""}${t.dueAt ? ` (due ${fmtWhen(new Date(t.dueAt), ctx.now, ctx.tz)})` : ""}${t.done ? " [done]" : ""}`)
          .join("\n"),
        summary: `${items.length} tasks`,
      };
    },
  ),
  def(
    "complete_task",
    "Mark a task as done. 'query' is words from the title or its position number in the open list.",
    { query: { type: "string" } },
    ["query"],
    async (a) => {
      const t = await findOpenTask(str(a.query));
      if (!t) return { output: "No matching open task found." };
      await updateTask(t.id, { done: true });
      return { output: `Marked "${t.title}" as done.`, refresh: ["tasks"], summary: t.title };
    },
  ),
  def(
    "delete_task",
    "Delete a task. 'query' is words from the title or its position number.",
    { query: { type: "string" } },
    ["query"],
    async (a) => {
      const all = await listTasks();
      const q = str(a.query);
      const t = (await findOpenTask(q)) ?? bestMatch(all, q, (x) => x.title);
      if (!t) return { output: "No matching task found." };
      await deleteTask(t.id);
      return { output: `Deleted task "${t.title}".`, refresh: ["tasks"], summary: t.title };
    },
  ),
  def("add_note", "Save a note for the user.", { content: { type: "string" } }, ["content"], async (a) => {
    const n = await addNote(str(a.content));
    return { output: `Note #${n.id} saved.`, refresh: ["notes"], summary: "saved" };
  }),
  def(
    "search_notes",
    "Search the user's notes. With an empty query, returns the most recent notes.",
    { query: { type: "string" } },
    [],
    async (a) => {
      const q = str(a.query);
      const items = q ? await searchNotes(q) : (await listNotes()).slice(0, 10);
      if (!items.length) return { output: "No matching notes." };
      return { output: items.slice(0, 10).map((n) => `- ${n.content}`).join("\n"), summary: `${items.length} notes` };
    },
  ),
  def(
    "set_reminder",
    "Schedule a reminder. Provide either 'in_minutes' (relative) or 'at' (absolute local ISO 'YYYY-MM-DDTHH:mm' in the user's timezone).",
    { label: { type: "string" }, in_minutes: { type: "number" }, at: { type: "string" } },
    ["label"],
    async (a, ctx) => {
      let due: Date | null = null;
      if (a.in_minutes !== undefined && Number.isFinite(num(a.in_minutes))) due = new Date(ctx.now.getTime() + num(a.in_minutes) * 60000);
      else if (a.at) due = parseLocalIso(str(a.at), ctx.tz);
      if (!due) return { output: "Need either in_minutes or a valid 'at' datetime." };
      if (due.getTime() <= ctx.now.getTime()) return { output: "That time is in the past." };
      const r = await addReminder({ label: str(a.label), kind: "reminder", dueAt: due });
      return { output: `Reminder #${r.id} set for ${fmtWhen(due, ctx.now, ctx.tz)}: "${r.label}".`, refresh: ["reminders"], summary: fmtWhen(due, ctx.now, ctx.tz) };
    },
  ),
  def(
    "set_timer",
    "Start a countdown timer.",
    { seconds: { type: "number" }, label: { type: "string" } },
    ["seconds"],
    async (a, ctx) => {
      const secs = Math.round(num(a.seconds));
      if (!Number.isFinite(secs) || secs < 1) return { output: "Timer duration must be at least 1 second." };
      const due = new Date(ctx.now.getTime() + secs * 1000);
      const r = await addReminder({ label: str(a.label) || "Timer", kind: "timer", dueAt: due, durationSec: secs });
      return { output: `Timer #${r.id} started for ${humanDuration(secs)}.`, refresh: ["reminders"], summary: humanDuration(secs) };
    },
  ),
  def("list_reminders", "List pending reminders and active timers.", {}, [], async (_a, ctx) => {
    const items = await pendingReminders();
    if (!items.length) return { output: "No pending reminders or timers." };
    return {
      output: items
        .map((r) => {
          const due = new Date(r.dueAt);
          const left = Math.max(0, Math.round((due.getTime() - ctx.now.getTime()) / 1000));
          return `${r.kind === "timer" ? "Timer" : "Reminder"} "${r.label}" — ${r.kind === "timer" ? `${humanDuration(left)} remaining` : fmtWhen(due, ctx.now, ctx.tz)}`;
        })
        .join("\n"),
      summary: `${items.length} active`,
    };
  }),
  def(
    "cancel_reminder",
    "Cancel a pending reminder or timer by matching words in its label, or cancel all of a kind.",
    { query: { type: "string" }, kind: { type: "string", enum: ["timer", "reminder", "any"] }, all: { type: "boolean" } },
    [],
    async (a) => {
      const kind = str(a.kind);
      if (a.all === true && (kind === "timer" || kind === "reminder")) {
        const n = await cancelPendingByKind(kind as ReminderKind);
        return { output: `Cancelled ${n} ${kind}(s).`, refresh: ["reminders"], summary: `${n} cancelled` };
      }
      const pool = (await pendingReminders()).filter((r) => kind === "timer" || kind === "reminder" ? r.kind === kind : true);
      const q = str(a.query);
      const hit = q ? bestMatch(pool, q, (r) => r.label) : pool.length === 1 ? pool[0] : null;
      if (!hit) return { output: pool.length ? "Multiple candidates; specify which one." : "Nothing to cancel." };
      await deleteReminder(hit.id);
      return { output: `Cancelled ${hit.kind} "${hit.label}".`, refresh: ["reminders"], summary: hit.label };
    },
  ),
  def(
    "remember_fact",
    "Store a long-term fact about the user or their preferences so it can be recalled in future sessions.",
    { fact: { type: "string" } },
    ["fact"],
    async (a) => {
      const { created } = await addMemory(str(a.fact));
      return { output: created ? "Remembered." : "I already knew that.", refresh: ["memories"], summary: "stored" };
    },
  ),
  def("forget_fact", "Delete a stored memory matching the query.", { query: { type: "string" } }, ["query"], async (a) => {
    const hit = await forgetMemory(str(a.query));
    return hit ? { output: `Forgot: "${hit.content}"`, refresh: ["memories"], summary: "forgotten" } : { output: "No matching memory." };
  }),
  def(
    "update_preferences",
    "Update the user's profile: their name, saved city (for weather) or measurement units.",
    { name: { type: "string" }, location: { type: "string" }, units: { type: "string", enum: ["metric", "imperial"] } },
    [],
    async (a) => {
      const patch: Partial<SettingsDTO> = {};
      if (a.name) patch.userName = str(a.name);
      if (a.location) patch.location = str(a.location);
      if (a.units === "metric" || a.units === "imperial") patch.units = a.units;
      await updateSettings(patch);
      return { output: "Preferences updated.", refresh: ["settings"], summary: Object.keys(patch).join(", ") };
    },
  ),
  def(
    "lookup_wikipedia",
    "Look up a factual summary on Wikipedia for a person, place, concept or event.",
    { topic: { type: "string" } },
    ["topic"],
    async (a) => {
      const r = await wikiLookup(str(a.topic));
      if (!r) return { output: "No Wikipedia article found." };
      return { output: `${r.title}${r.description ? ` (${r.description})` : ""}: ${firstSentences(r.extract, 4, 700)}`, summary: r.title };
    },
  ),
  def("define_word", "Get the dictionary definition of an English word.", { word: { type: "string" } }, ["word"], async (a) => {
    const d = await defineWord(str(a.word));
    if (!d) return { output: "No definition found." };
    return { output: `${d.word}${d.partOfSpeech ? ` (${d.partOfSpeech})` : ""}: ${d.definition}${d.example ? ` Example: "${d.example}"` : ""}`, summary: d.word };
  }),
  def(
    "search_web",
    "Search the web and return the top results with titles, URLs and snippets.",
    { query: { type: "string" }, count: { type: "number", description: "Max results, default 5." } },
    ["query"],
    async (a) => {
      const results = await searchWeb(str(a.query), Math.min(Math.max(num(a.count) || 5, 1), 10));
      if (!results.length) return { output: "No results found." };
      const out = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");
      return { output: out, summary: `${results.length} results` };
    },
  ),
  def(
    "translate_text",
    "Translate text into a target language (ISO 639-1 codes like es, fr, ja). Source auto-detected when omitted.",
    { text: { type: "string" }, target: { type: "string", description: "Target language code, e.g. 'es'." }, source: { type: "string", description: "Optional source language code." } },
    ["text", "target"],
    async (a) => {
      const out = await translateText(str(a.text), str(a.target), a.source ? str(a.source) : undefined);
      return { output: out, summary: `→${str(a.target)}` };
    },
  ),
  def(
    "get_calendar_events",
    "List upcoming events from the configured calendar (ICS feed). Set CALENDAR_ICS_URL in the server environment.",
    { limit: { type: "number", description: "Max events, default 10." } },
    [],
    async (a, ctx) => {
      const url = env("CALENDAR_ICS_URL");
      if (!url) return { output: "No calendar feed configured. Set CALENDAR_ICS_URL in the server environment." };
      const events = await fetchIcsEvents(url, Math.min(Math.max(num(a.limit) || 10, 1), 25));
      if (!events.length) return { output: "No upcoming events on the calendar.", summary: "empty" };
      const out = events
        .map((e) => `• ${fmtWhen(e.start, ctx.now, ctx.tz)}${e.location ? ` @ ${e.location}` : ""} — ${e.summary}`)
        .join("\n");
      return { output: out, summary: `${events.length} events` };
    },
  ),
  def("system_status", "Report assistant diagnostics: database latency, uptime and data counts.", {}, [], async (_a, ctx) => {
    const st = await collectStatus();
    return {
      output: `Database ${st.dbMs} ms; uptime ${humanDuration(st.uptimeSec)}; memory ${st.rssMb} MB; skills ${ctx.skillCount}; ${st.stats.openTasks} open tasks, ${st.stats.notes} notes, ${st.stats.pendingReminders} pending alerts, ${st.stats.memories} memories.`,
      summary: "ok",
    };
  }),
];

export async function getToolSpecs(): Promise<ToolSpec[]> {
  const { getMcpToolSpecs } = await import("./mcp");
  const mcpSpecs = await getMcpToolSpecs();
  return [...TOOLS.map((t) => t.spec), ...mcpSpecs];
}

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.spec.function.name === name);
  if (tool) {
    const result = await tool.run(args, ctx);
    const refresh: ResourceKey[] | undefined = result.refresh;
    return { ...result, refresh };
  }
  if (name.startsWith("mcp__")) {
    const { runMcpTool } = await import("./mcp");
    try {
      const output = await runMcpTool(name, args);
      return { output, summary: "MCP" };
    } catch (err) {
      return { output: `MCP tool error: ${err instanceof Error ? err.message : err}` };
    }
  }
  return { output: `Unknown tool: ${name}` };
}
