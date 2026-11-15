import type { BrainMode, Priority } from "@/lib/types";
import {
  addMemory,
  addNote,
  addReminder,
  addTask,
  bestMatch,
  cancelPendingByKind,
  clearCompletedTasks,
  deleteAllMemories,
  deleteAllNotes,
  deleteAllTasks,
  deleteNote,
  deleteReminder,
  deleteTask,
  findOpenTask,
  forgetMemory,
  listMemories,
  listNotes,
  listTasks,
  openTasks,
  pendingReminders,
  searchNotes,
  updateSettings,
  updateTask,
} from "../data";
import { fmtTime, fmtWhen, humanDuration, parseDuration, parseWhen } from "../timeutil";
import { bullets, cap, cleanFragment, pick, plural, type Skill } from "./core";

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function extractPriority(title: string): { title: string; priority: Priority } {
  const hi = /\b(?:urgent(?:ly)?|high[- ]priority|top priority|asap|important)\b/gi;
  const lo = /\blow[- ]priority\b/gi;
  if (hi.test(title)) return { title: cleanFragment(title.replace(hi, " ")), priority: "high" };
  if (lo.test(title)) return { title: cleanFragment(title.replace(lo, " ")), priority: "low" };
  return { title: cleanFragment(title), priority: "normal" };
}

const TASK_ADD: RegExp[] = [
  /^(?:add|create|make|new|put)\s+(?:a\s+|an\s+|another\s+)?(?:new\s+)?(?:[\w-]+\s+){0,2}?(?:task|to-?do|todo)\b(?:\s+(?:to|for|called|named|titled|that says|saying))?\s*[:,-]?\s*(.+)$/i,
  /^(?:add|put)\s+(.+?)\s+(?:to|on|onto|in)\s+(?:my|the)\s+(?:task|to-?do|todo)s?(?:\s+list)?$/i,
  /^(?:remember|don'?t forget|do not forget)\s+to\s+(.+)$/i,
  /^(?:task|todo|to-?do)\s*[:,-]\s*(.+)$/i,
];

const TASK_LIST =
  /^(?:what(?:'s| is| are)?|show|list|read|tell me|give me|do i have|have i got|how many|whats|display|view|check|any)\b.*\b(?:tasks?|to-?dos?|todo list|to do list)\b/;

const TASK_COMPLETE: RegExp[] = [
  /^(?:complete|finish|finished|check off|tick off|cross off|mark off|done with|i(?:'ve| have)? (?:finished|completed|done)|i'?m done with)\s+(?:the\s+|my\s+)?(?:task\s+)?(.+?)(?:\s+(?:task|as (?:done|complete|completed|finished)))*$/i,
  /^mark\s+(?:the\s+|my\s+)?(?:task\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/i,
  /^(?:task\s+)?(#?\d+)\s+(?:is\s+)?(?:done|complete|completed|finished)$/i,
];

export const tasksSkill: Skill = {
  name: "tasks",
  async run(ctx) {
    const o = ctx.original;
    const t = ctx.text;

    // clear / delete
    if (/^(?:clear|delete|remove)\s+(?:all\s+)?(?:my\s+)?(?:completed|done|finished)\s+(?:tasks|to-?dos)$/.test(t)) {
      const n = await clearCompletedTasks();
      return { skill: "tasks", refresh: ["tasks"], reply: n ? `Cleared ${plural(n, "completed task")}. Tidy.` : "There were no completed tasks to clear." };
    }
    if (/^(?:clear|delete|remove|wipe)\s+(?:all\s+)?(?:of\s+)?(?:my\s+)?(?:tasks|to-?dos|to-?do list|task list)$/.test(t)) {
      const n = await deleteAllTasks();
      return { skill: "tasks", refresh: ["tasks"], reply: n ? `Done — ${plural(n, "task")} removed. A clean slate, ${ctx.addr}.` : "Your list was already empty." };
    }
    let m = o.match(/^(?:delete|remove|drop|erase|scrap|discard)\s+(?:the\s+|my\s+)?task\s+(.+)$/i) ?? o.match(/^(?:delete|remove|drop|erase|scrap)\s+(.+?)\s+from\s+(?:my\s+|the\s+)?(?:task|to-?do)s?(?:\s+list)?$/i);
    if (m) {
      const q = m[1].trim();
      const target = (await findOpenTask(q)) ?? bestMatch(await listTasks(), q, (x) => x.title);
      if (!target) return { skill: "tasks", reply: `I couldn't find a task matching "${q}".` };
      await deleteTask(target.id);
      return { skill: "tasks", refresh: ["tasks"], reply: `Removed "${target.title}" from your list.` };
    }

    // complete
    for (const re of TASK_COMPLETE) {
      m = o.match(re);
      if (!m) continue;
      const q = m[1].trim();
      const target = await findOpenTask(q);
      if (!target) {
        if (/\btask\b/i.test(o)) return { skill: "tasks", reply: `I couldn't find an open task matching "${q}".` };
        break;
      }
      await updateTask(target.id, { done: true });
      const left = (await openTasks()).length;
      return {
        skill: "tasks",
        refresh: ["tasks"],
        reply: `Marked "${target.title}" as done. ${left ? `${plural(left, "task")} remaining.` : "That's everything — your list is clear."}`,
      };
    }

    // list
    if (TASK_LIST.test(t) && !/\b(?:add|create|remind)\b/.test(t)) {
      const all = await listTasks();
      const open = all.filter((x) => !x.done);
      const done = all.length - open.length;
      if (/^how many/.test(t)) {
        return { skill: "tasks", reply: `You have ${plural(open.length, "open task")}${done ? ` and ${done} completed` : ""}.` };
      }
      if (!open.length) return { skill: "tasks", reply: `Your task list is clear, ${ctx.addr}.${done ? ` (${done} completed.)` : ""}` };
      const lines = open.map((x, i) => `${i + 1}. ${x.title}${x.priority === "high" ? " ❗" : ""}${x.dueAt ? ` — due ${fmtWhen(new Date(x.dueAt), ctx.now, ctx.tz)}` : ""}`);
      return { skill: "tasks", reply: `You have ${plural(open.length, "open task")}, ${ctx.addr}:\n${lines.join("\n")}${done ? `\n(${done} completed)` : ""}` };
    }

    // add
    for (const re of TASK_ADD) {
      m = o.match(re);
      if (!m) continue;
      let title = m[1];
      let dueAt: Date | null = null;
      const w = parseWhen(title, ctx.now, ctx.tz);
      if (w) {
        dueAt = w.date;
        title = w.rest.replace(/\b(?:by|due|before|until|on|at)\s*$/i, "");
      }
      const p = extractPriority(title);
      if (!p.title) return null;
      // The priority may have been consumed by the command prefix ("add a high priority task ...").
      const priority: Priority = p.priority !== "normal" ? p.priority : extractPriority(o).priority;
      const task = await addTask({ title: cap(p.title), priority, dueAt });
      const total = (await openTasks()).length;
      return {
        skill: "tasks",
        refresh: ["tasks"],
        reply: `${pick(["Added", "Noted", "Task logged"])}: "${task.title}"${priority === "high" ? " (high priority)" : ""}${dueAt ? `, due ${fmtWhen(dueAt, ctx.now, ctx.tz)}` : ""}. You now have ${plural(total, "open task")}.`,
      };
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const NOTE_ADD: RegExp[] = [
  /^(?:take|make|write|save|add|create|jot|record)\s+(?:down\s+)?(?:a\s+|another\s+)?(?:quick\s+|new\s+)?note(?:\s+to\s+self)?(?:\s+(?:that|saying|about|which says))?\s*[:,-]?\s*(.+)$/i,
  /^note(?:\s+to\s+self)?(?:\s+(?:that|down))?\s*[:,-]\s*(.+)$/i,
  /^note\s+(?:that|down)\s+(.+)$/i,
  /^(?:jot|write)\s+down\s+(?:that\s+)?(.+)$/i,
  /^(?:save|store)\s+(?:this|that)\s*[:,-]?\s*(.+)$/i,
];

export const notesSkill: Skill = {
  name: "notes",
  async run(ctx) {
    const o = ctx.original;
    const t = ctx.text;
    let m: RegExpMatchArray | null;

    if (/^(?:delete|remove|erase|clear)\s+(?:all\s+)(?:of\s+)?(?:my\s+)?notes$/.test(t)) {
      const n = await deleteAllNotes();
      return { skill: "notes", refresh: ["notes"], reply: n ? `Erased ${plural(n, "note")}.` : "You have no notes to erase." };
    }
    if (/^(?:delete|remove|erase)\s+(?:the\s+|my\s+)?(?:last|latest|most recent)\s+note$/.test(t)) {
      const last = (await listNotes())[0];
      if (!last) return { skill: "notes", reply: "There are no notes to delete." };
      await deleteNote(last.id);
      return { skill: "notes", refresh: ["notes"], reply: `Deleted your latest note: "${last.content.slice(0, 80)}".` };
    }
    m = o.match(/^(?:delete|remove|erase)\s+(?:the\s+|my\s+)?note\s+(?:about\s+|on\s+|regarding\s+)?(.+)$/i);
    if (m) {
      const hit = (await searchNotes(m[1]))[0];
      if (!hit) return { skill: "notes", reply: `I couldn't find a note matching "${m[1]}".` };
      await deleteNote(hit.id);
      return { skill: "notes", refresh: ["notes"], reply: `Deleted the note: "${hit.content.slice(0, 80)}".` };
    }

    m = o.match(/^(?:find|search|look)\s*(?:for\s+|up\s+)?(?:in\s+)?(?:my\s+)?notes?\s+(?:for|about|on|containing|with|regarding)\s+(.+)$/i) ?? o.match(/^what did i (?:note|write|jot)(?: down)?\s+(?:about|on|regarding)\s+(.+)$/i);
    if (m) {
      const hits = await searchNotes(m[1]);
      if (!hits.length) return { skill: "notes", reply: `Nothing in your notes about "${m[1]}".` };
      return { skill: "notes", reply: `${plural(hits.length, "note")} mentioning "${m[1]}":\n${bullets(hits.slice(0, 6).map((n) => n.content))}` };
    }

    if (/^(?:show|list|read|what are|what'?s in|open|display|give me|view)\s+(?:me\s+)?(?:all\s+)?(?:my\s+|the\s+)?(?:recent\s+|latest\s+)?notes(?:\s+list)?$/.test(t) || /^(?:read|show)\s+(?:me\s+)?(?:my\s+)?(?:last|latest)\s+note$/.test(t)) {
      const notes = await listNotes();
      if (!notes.length) return { skill: "notes", reply: `You haven't saved any notes yet, ${ctx.addr}. Try "take a note: ...".` };
      const latestOnly = /last|latest/.test(t) && /note$/.test(t);
      const shown = latestOnly ? notes.slice(0, 1) : notes.slice(0, 8);
      return { skill: "notes", reply: `${latestOnly ? "Your latest note" : `You have ${plural(notes.length, "note")}`}:\n${bullets(shown.map((n) => n.content))}${!latestOnly && notes.length > 8 ? `\n…and ${notes.length - 8} older.` : ""}` };
    }

    for (const re of NOTE_ADD) {
      m = o.match(re);
      if (!m) continue;
      const content = m[1].trim();
      if (!content) return null;
      await addNote(cap(content));
      return { skill: "notes", refresh: ["notes"], reply: `${pick(["Noted", "Saved", "Written down"])}, ${ctx.addr}.` };
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Reminders & timers
// ---------------------------------------------------------------------------

const REMIND_PATTERNS: { re: RegExp; label?: string; soft?: boolean }[] = [
  { re: /^remind me\b[\s,:]*(.*)$/i },
  { re: /^(?:set|create|add|make|schedule)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:new\s+)?(?:reminder|alarm|alert)\b[\s,:]*(.*)$/i },
  { re: /^(?:alert|notify|ping|buzz)\s+me\b[\s,:]*(.*)$/i },
  { re: /^wake me(?:\s+up)?\b[\s,:]*(.*)$/i, label: "Wake up" },
  { re: /^(?:remember|don'?t forget|do not forget)\s+to\s+(.+)$/i, soft: true },
];

export const remindersSkill: Skill = {
  name: "reminders",
  async run(ctx) {
    const o = ctx.original;
    const t = ctx.text;
    let m: RegExpMatchArray | null;

    // ---- cancel ----
    m = o.match(/^(?:cancel|stop|delete|remove|clear|dismiss|kill|abort|turn off)\b(.*)$/i);
    if (m && /\b(?:timers?|reminders?|alarms?)\b/i.test(m[1])) {
      const rest = m[1];
      const kind = /timer/i.test(rest) ? "timer" : "reminder";
      const all = /\b(?:all|every)\b|(?:timers|reminders|alarms)\s*$/i.test(rest);
      const query = rest
        .replace(/\b(?:all|every|my|the|that|this|of|timers?|reminders?|alarms?|for|about|to|named|called)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (all && !query) {
        const n = await cancelPendingByKind(kind);
        return { skill: "reminders", refresh: ["reminders"], reply: n ? `Cancelled ${plural(n, kind)}.` : `You have no active ${kind}s.` };
      }
      const pool = (await pendingReminders()).filter((r) => r.kind === kind);
      if (!pool.length) return { skill: "reminders", reply: `You have no active ${kind}s, ${ctx.addr}.` };
      const target = query ? bestMatch(pool, query, (r) => r.label) : pool[0];
      if (!target) return { skill: "reminders", reply: `I couldn't find a ${kind} matching "${query}".` };
      await deleteReminder(target.id);
      return {
        skill: "reminders",
        refresh: ["reminders"],
        reply: `Cancelled the ${kind} "${target.label}".${!query && pool.length > 1 ? ` (That was the soonest of ${pool.length}.)` : ""}`,
      };
    }

    // ---- list / status ----
    if (/\b(?:reminders?|timers?|alarms?|alerts?)\b/.test(t) && /^(?:what|which|show|list|do i have|have i got|any|how many|how much|how long|when|tell me|check|read|view|display|are there|is there)\b/.test(t)) {
      const pending = await pendingReminders();
      if (!pending.length) return { skill: "reminders", reply: `You have no active timers or reminders, ${ctx.addr}.` };
      const lines = pending.map((r) => {
        const due = new Date(r.dueAt);
        const left = Math.max(0, Math.round((due.getTime() - ctx.now.getTime()) / 1000));
        return r.kind === "timer" ? `⏱ ${r.label} — ${humanDuration(left)} remaining` : `⏰ ${r.label} — ${fmtWhen(due, ctx.now, ctx.tz)} (in ${humanDuration(left)})`;
      });
      return { skill: "reminders", reply: `${plural(pending.length, "active alert")}:\n${lines.join("\n")}` };
    }

    // ---- timer ----
    if (
      /\btimer\b/.test(t) &&
      /^(?:set|start|create|begin|run|make|put|launch|initiate|new|add|i need|i want|give me|can i get|count)\b|^\d|^(?:an?|one)\s/.test(t)
    ) {
      const dur = parseDuration(o, { shorthand: true });
      if (!dur || dur.seconds < 1) {
        if (ctx.cloudAvailable) return null;
        return { skill: "reminders", reply: `For how long should I run the timer, ${ctx.addr}? For example: "set a 10 minute timer".` };
      }
      const label = cap(
        dur.rest
          .replace(/\b(?:set|start|create|begin|run|make|put|launch|initiate|new|add|a|an|the|timer|for|of|me|please|on|i|need|want|give|can|get|count|down|countdown)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      const due = new Date(ctx.now.getTime() + dur.seconds * 1000);
      await addReminder({ label: label || "Timer", kind: "timer", dueAt: due, durationSec: Math.round(dur.seconds) });
      return {
        skill: "reminders",
        refresh: ["reminders"],
        reply: `${label ? `${label} timer` : "Timer"} set for ${humanDuration(dur.seconds)}. I'll alert you at ${fmtTime(due, ctx.tz)}.`,
      };
    }

    // ---- reminder ----
    for (const p of REMIND_PATTERNS) {
      m = o.match(p.re);
      if (!m) continue;
      const body = m[1] ?? "";
      const w = parseWhen(body, ctx.now, ctx.tz);
      if (!w) {
        if (p.soft || ctx.cloudAvailable) return null;
        if (!body.trim()) return { skill: "reminders", reply: `What shall I remind you about, ${ctx.addr}, and when?` };
        return { skill: "reminders", reply: `When should I remind you? Try: "remind me to ${cleanFragment(body) || "call mom"} in 20 minutes" or "at 6 pm".` };
      }
      if (w.date.getTime() <= ctx.now.getTime() + 1000) {
        return { skill: "reminders", reply: `That time has already passed, ${ctx.addr}. Give me a moment in the future.` };
      }
      const label = cap(cleanFragment(w.rest)) || p.label || "Reminder";
      await addReminder({ label, kind: "reminder", dueAt: w.date });
      const secs = (w.date.getTime() - ctx.now.getTime()) / 1000;
      const when = w.relative ? `in ${humanDuration(secs)} (${fmtTime(w.date, ctx.tz)})` : fmtWhen(w.date, ctx.now, ctx.tz);
      return { skill: "reminders", refresh: ["reminders"], reply: `${pick(["Reminder set", "Consider it done", "Reminder locked in"])}, ${ctx.addr}: "${label}" — ${when}.` };
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Memory & profile
// ---------------------------------------------------------------------------

function titleCaseName(n: string): string {
  const name = n.trim().replace(/[.!,]+$/g, "");
  return name === name.toLowerCase() ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : name;
}

export const memorySkill: Skill = {
  name: "memory",
  async run(ctx) {
    const o = ctx.original;
    const t = ctx.text;
    let m: RegExpMatchArray | null;

    m = o.match(/^(?:my name is|call me|i am called|i'?m called|you can call me|the name'?s|name'?s|my name'?s)\s+(.+)$/i);
    if (m && m[1].split(/\s+/).length <= 4) {
      const name = titleCaseName(m[1].replace(/^(?:is\s+)/i, ""));
      await updateSettings({ userName: name });
      return { skill: "memory", refresh: ["settings"], reply: `A pleasure to meet you, ${name}. I'll address you that way from now on.` };
    }

    m = o.match(/^(?:i live in|i'?m from|i am from|my (?:home )?(?:city|location|town) is|set (?:my )?(?:home )?(?:city|location) (?:to|as)|i'?m located in|i am located in|i'?m based in|i am based in|my home is in|i'?m in)\s+(.+)$/i);
    if (m && m[1].split(/\s+/).length <= 4 && !/\b(?:a hurry|trouble|love|the mood|need|between)\b/i.test(m[1])) {
      const loc = titleCaseName(m[1]);
      await updateSettings({ location: loc });
      return { skill: "memory", refresh: ["settings"], reply: `Location set to ${loc}. Weather and briefings will default there.` };
    }

    // recall
    if (/^(?:what do you (?:remember|know)(?: about me)?|what have i told you|what do you know about me|recall(?: everything)?|show (?:me )?(?:my )?(?:memories|memory)|list (?:my )?memories|what'?s in your memory)$/.test(t)) {
      const mem = await listMemories();
      const prof = [ctx.settings.userName && `Your name is ${ctx.settings.userName}`, ctx.settings.location && `You're based in ${ctx.settings.location}`].filter(Boolean) as string[];
      const all = [...prof, ...mem.map((x) => x.content)];
      if (!all.length) return { skill: "memory", reply: `Nothing yet, ${ctx.addr}. Tell me something with "remember that ...".` };
      return { skill: "memory", reply: `Here's what I know:\n${bullets(all.slice(0, 12))}` };
    }
    if (/^(?:who am i|do you know my name|what am i called|what'?s my name|what is my name)$/.test(t)) {
      return { skill: "memory", reply: ctx.settings.userName ? `You're ${ctx.settings.userName}.` : `I don't have your name on file, ${ctx.addr}. Tell me with "my name is ...".` };
    }
    m = t.match(/^(?:what(?:'s| is)|whats) my (.+)$/);
    if (m) {
      const key = m[1].trim();
      if (/^(?:location|city|home|home city|home town|hometown)$/.test(key)) {
        return { skill: "memory", reply: ctx.settings.location ? `You're based in ${ctx.settings.location}.` : `I don't have your location yet. Tell me "I live in ...".` };
      }
      const hit = bestMatch(await listMemories(), key, (x) => x.content);
      if (hit) return { skill: "memory", reply: `${hit.content}.`.replace(/\.\.$/, ".") };
      return null;
    }

    // forget
    m = o.match(/^forget\s+(?:about\s+|that\s+)?(.+)$/i);
    if (m) {
      if (/^(?:everything|all|it all|all of it|all memories|everything you know)$/i.test(m[1].trim())) {
        const n = await deleteAllMemories();
        return { skill: "memory", refresh: ["memories"], reply: n ? `Memory wiped — ${plural(n, "item")} erased.` : "There was nothing to forget." };
      }
      const hit = await forgetMemory(m[1]);
      if (!hit) return { skill: "memory", reply: `I don't have anything matching "${m[1]}".` };
      return { skill: "memory", refresh: ["memories"], reply: `Forgotten: "${hit.content}".` };
    }

    // remember
    m = o.match(/^(?:remember|memorize|keep in mind|please remember|make a mental note)\s+(?:that\s+)?(.+)$/i);
    if (m && !/^to\s/i.test(m[1])) {
      const { created } = await addMemory(cap(m[1].trim()));
      return { skill: "memory", refresh: ["memories"], reply: created ? `Noted, ${ctx.addr}. I'll remember that.` : "I already had that on file." };
    }
    m = o.match(/^(my|our)\s+([\w' -]{2,40}?)\s+(is|are|was)\s+(.+)$/i);
    if (m && !/\b(?:task|tasks|note|notes|reminder|timer|list|name|location)\b/i.test(m[2])) {
      const { created } = await addMemory(cap(o));
      return { skill: "memory", refresh: ["memories"], reply: created ? `Understood, ${ctx.addr}. Filed away.` : "Already on file." };
    }
    m = o.match(/^i\s+(?:prefer|am allergic to|usually|always|never)\s+.+$/i);
    if (m) {
      const { created } = await addMemory(cap(o));
      return { skill: "memory", refresh: ["memories"], reply: created ? `Noted — I'll keep that in mind, ${ctx.addr}.` : "Already on file." };
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Preferences, modes & session control
// ---------------------------------------------------------------------------

export const preferencesSkill: Skill = {
  name: "settings",
  async run(ctx) {
    const o = ctx.original;
    const t = ctx.text;
    let m: RegExpMatchArray | null;

    m = t.match(/^(?:switch|go|change|set|use|enable|activate|turn on|engage|work)\s+(?:to\s+|into\s+|in\s+)?(?:the\s+)?(?:brain\s+|mode\s+)?(?:to\s+)?(local|offline|cloud|online|hybrid)(?:\s+(?:mode|brain|core|only))?$/);
    if (m) {
      const mode: BrainMode = m[1] === "local" || m[1] === "offline" ? "local" : m[1] === "cloud" ? "cloud" : "hybrid";
      await updateSettings({ brainMode: mode });
      const note =
        mode !== "local" && !ctx.cloudAvailable
          ? " Note: no cloud API key is configured, so I'll keep using the local core until one is."
          : "";
      const desc = { local: "Local core only — fully offline-capable.", hybrid: "Hybrid mode — local skills first, cloud brain for everything else.", cloud: "Cloud-first — the cloud brain handles everything, with tools." }[mode];
      return { skill: "settings", refresh: ["settings"], reply: `${desc}${note}` };
    }

    m = t.match(/^(?:use|switch to|set|change to|go|show)\s+(?:the\s+)?(metric|imperial|fahrenheit|celsius)(?:\s+(?:units?|system|measurements?))?$/);
    if (m) {
      const units = m[1] === "imperial" || m[1] === "fahrenheit" ? "imperial" : "metric";
      await updateSettings({ units });
      return { skill: "settings", refresh: ["settings"], reply: `Switched to ${units} units.` };
    }

    if (/^(?:mute|be quiet|silence|voice off|turn off (?:the )?voice|disable (?:the )?voice|text only|mute (?:yourself|voice)|stop talking so much)$/.test(t)) {
      await updateSettings({ autoSpeak: false });
      return { skill: "settings", refresh: ["settings"], client: { type: "set_autospeak", value: false }, reply: "Voice replies disabled. I'll stick to text." };
    }
    if (/^(?:unmute|voice on|turn on (?:the )?voice|enable (?:the )?voice|speak (?:to me|out loud|aloud)|talk to me|unmute (?:yourself|voice))$/.test(t)) {
      await updateSettings({ autoSpeak: true });
      return { skill: "settings", refresh: ["settings"], client: { type: "set_autospeak", value: true }, reply: `Voice replies enabled. Hello again, ${ctx.addr}.` };
    }

    m = o.match(/^(?:from now on,? )?(?:your name is|i'?ll call you|you(?:'re| are) now|rename yourself to|call yourself)\s+(.+)$/i);
    if (m && m[1].split(/\s+/).length <= 3) {
      const name = m[1].trim().replace(/[.!]+$/, "");
      await updateSettings({ assistantName: name });
      return { skill: "settings", refresh: ["settings"], reply: `Very well. I'll answer to ${name} from now on.` };
    }

    if (/^(?:new (?:session|conversation|chat)|clear (?:the |this )?(?:chat|conversation|screen|console|history)|start over|reset (?:the )?(?:chat|conversation)|start a new (?:session|conversation|chat))$/.test(t)) {
      return { skill: "session", client: { type: "new_session" }, reply: "Session cleared. Starting fresh." };
    }
    return null;
  },
};
