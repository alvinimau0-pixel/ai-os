import { randomInt } from "node:crypto";
import { openTasks, pendingReminders } from "../data";
import { formatNumber, tryMath } from "../math";
import { collectStatus } from "../tools";
import { CITY_TZ, fmtDate, fmtTime, fmtWhen, humanDuration, WEEKDAY_NAMES, zparts } from "../timeutil";
import { convertUnits, CURRENCY_ALIASES, parseConversion } from "../units";
import { convertCurrency, defineWord, describeWeather, firstSentences, getWeather, wikiLookup } from "../web";
import { bullets, cap, partOfDay, plural, type Skill, type SkillContext } from "./core";

// ---------------------------------------------------------------------------
// Time & date
// ---------------------------------------------------------------------------

function resolveTz(place: string): string | null {
  const p = place.toLowerCase().replace(/[.,!?]/g, "").trim();
  if (CITY_TZ[p]) return CITY_TZ[p];
  const key = Object.keys(CITY_TZ)
    .sort((a, b) => b.length - a.length)
    .find((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(p));
  return key ? CITY_TZ[key] : null;
}

const TIME_RE =
  /^(?:what(?:'s| is)?(?: the)?(?: current| local)? time(?: is it)?(?: right now| now| currently)?|what time is it(?: right now| now)?|(?:tell me )?the (?:current )?time|current time|time(?: now)?)(?:\s+(?:in|at|for)\s+(.+))?$/;

export const timeSkill: Skill = {
  name: "time",
  run(ctx) {
    const m = ctx.text.match(TIME_RE);
    if (!m) return null;
    if (m[1]) {
      const tz = resolveTz(m[1]);
      if (!tz) {
        return ctx.cloudAvailable ? null : { skill: "time", reply: `I don't have timezone data for "${m[1]}" offline. Try a major city, ${ctx.addr}.` };
      }
      const here = zparts(ctx.now, ctx.tz);
      const there = zparts(ctx.now, tz);
      const dayNote = here.day !== there.day ? ` (${cap(WEEKDAY_NAMES[there.weekday])})` : "";
      return { skill: "time", reply: `It's ${fmtTime(ctx.now, tz)}${dayNote} in ${cap(m[1].trim())}.` };
    }
    return { skill: "time", reply: `It's ${fmtTime(ctx.now, ctx.tz)}, ${ctx.addr} — ${fmtDate(ctx.now, ctx.tz)}.` };
  },
};

export const dateSkill: Skill = {
  name: "date",
  run(ctx) {
    if (
      !/^(?:what(?:'s| is)?(?: the)?(?: today'?s)? date(?: today)?|what day(?: of the week)? is (?:it|today)(?: today)?|what'?s today|today'?s date|what is today|what'?s the day|which day is it|date|what'?s the date today)$/.test(
        ctx.text,
      )
    )
      return null;
    return { skill: "date", reply: `Today is ${fmtDate(ctx.now, ctx.tz)}.` };
  },
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const HOLIDAYS: Record<string, [number, number, string]> = {
  christmas: [12, 25, "Christmas"],
  "christmas eve": [12, 24, "Christmas Eve"],
  "new year": [1, 1, "New Year's Day"],
  "new years": [1, 1, "New Year's Day"],
  "new years eve": [12, 31, "New Year's Eve"],
  halloween: [10, 31, "Halloween"],
  valentines: [2, 14, "Valentine's Day"],
  independence: [7, 4, "Independence Day"],
  "4th of july": [7, 4, "Independence Day"],
  "fourth of july": [7, 4, "Independence Day"],
  "st patricks": [3, 17, "St. Patrick's Day"],
  "april fools": [4, 1, "April Fools' Day"],
};

function thanksgiving(year: number): number {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return 1 + ((4 - first + 7) % 7) + 21;
}

export const countdownSkill: Skill = {
  name: "countdown",
  run(ctx) {
    const m = ctx.original.match(/^(?:how (?:many days|long|much time)|days)\s+(?:is it\s+|are there\s+|is there\s+|do i have\s+)?(?:left\s+)?(?:until|till|to|before)\s+(.+)$/i);
    if (!m) return null;
    const target = m[1].toLowerCase().replace(/[’']/g, "").replace(/^the\s+/, "").replace(/\s+day$/, "").trim();
    const np = zparts(ctx.now, ctx.tz);
    const today = Date.UTC(np.year, np.month - 1, np.day);
    let label = "";
    let ts: number | null = null;

    const pickYear = (mo: number, d: number, explicitYear?: number) => {
      let y = explicitYear ?? np.year;
      let t = Date.UTC(y, mo - 1, d);
      if (!explicitYear && t < today) {
        y += 1;
        t = Date.UTC(y, mo - 1, d);
      }
      return t;
    };

    if (HOLIDAYS[target]) {
      const [mo, d, name] = HOLIDAYS[target];
      ts = pickYear(mo, d);
      label = name;
    } else if (target === "thanksgiving") {
      let t = Date.UTC(np.year, 10, thanksgiving(np.year));
      if (t < today) t = Date.UTC(np.year + 1, 10, thanksgiving(np.year + 1));
      ts = t;
      label = "Thanksgiving";
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(target)) {
      const [y, mo, d] = target.split("-").map(Number);
      ts = Date.UTC(y, mo - 1, d);
    } else if (WEEKDAY_NAMES.includes(target) || target === "weekend") {
      const wd = target === "weekend" ? 6 : WEEKDAY_NAMES.indexOf(target);
      ts = today + (((wd - np.weekday + 7) % 7) || 7) * 86400000;
      label = cap(target);
    } else {
      const g =
        target.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})(?:,?\s*(\d{4}))?$/) ??
        target.match(/^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
      if (g) {
        const first = /^\d/.test(g[1]);
        const dayNum = Number(first ? g[1] : g[2]);
        const monName = first ? g[2] : g[1];
        const mo = MONTHS.findIndex((x) => x.startsWith(monName.slice(0, 3))) + 1;
        if (mo > 0 && dayNum >= 1 && dayNum <= 31) ts = pickYear(mo, dayNum, g[3] ? Number(g[3]) : undefined);
      }
    }
    if (ts === null) return null;
    const days = Math.round((ts - today) / 86400000);
    const when = fmtDate(new Date(ts + 12 * 3600000), "UTC");
    const name = label || when;
    let reply: string;
    if (days === 0) reply = `That's today, ${ctx.addr} — ${when}.`;
    else if (days === 1) reply = `${name} is tomorrow (${when}).`;
    else if (days < 0) reply = `${name} was ${plural(-days, "day")} ago.`;
    else {
      const weeks = Math.floor(days / 7);
      reply = `${plural(days, "day")} until ${name}${weeks >= 2 ? ` — about ${plural(weeks, "week")}` : ""}.${label ? ` That's ${when}.` : ""}`;
    }
    return { skill: "countdown", reply };
  },
};

// ---------------------------------------------------------------------------
// Math, units, currency
// ---------------------------------------------------------------------------

export const mathSkill: Skill = {
  name: "math",
  run(ctx) {
    const r = tryMath(ctx.original);
    if (!r) return null;
    const v = formatNumber(r.value);
    return { skill: "math", reply: `${r.expr.length <= 40 ? `${r.expr} = ` : "That comes to "}${v}.` };
  },
};

export const unitsSkill: Skill = {
  name: "units",
  run(ctx) {
    const p = parseConversion(ctx.text);
    if (!p) return null;
    const r = convertUnits(p.value, p.from, p.to);
    if (!r) return null;
    if (r === "mismatch") return { skill: "units", reply: `Those two units measure different things, ${ctx.addr}, so I can't convert between them.` };
    const result = Number(r.result.toPrecision(6));
    return { skill: "units", reply: `${formatNumber(r.value)} ${r.from} is ${formatNumber(result)} ${r.to}.` };
  },
};

export const currencySkill: Skill = {
  name: "currency",
  async run(ctx) {
    const m = ctx.text.match(/^(?:convert\s+|what(?:'s| is)\s+|how much is\s+)?(\d+(?:\.\d+)?)\s*([a-z]{2,10}(?: dollars)?)\s+(?:to|in|into)\s+([a-z]{2,10})$/);
    if (!m) return null;
    const from = CURRENCY_ALIASES[m[2].trim()];
    const to = CURRENCY_ALIASES[m[3].trim()];
    if (!from || !to) return null;
    const amount = Number(m[1]);
    if (from === to) return { skill: "currency", reply: `${formatNumber(amount)} ${from} is… ${formatNumber(amount)} ${to}. A solid exchange rate, ${ctx.addr}.` };
    try {
      const r = await convertCurrency(amount, from, to);
      return {
        skill: "currency",
        reply: `${formatNumber(amount)} ${from} is ${formatNumber(Math.round(r.result * 100) / 100)} ${to} at today's rate of ${r.rate}${r.date ? ` (${r.date})` : ""}.`,
      };
    } catch {
      return { skill: "currency", reply: "I couldn't reach the exchange-rate service just now. Currency conversion needs an internet connection." };
    }
  },
};

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export const weatherSkill: Skill = {
  name: "weather",
  async run(ctx) {
    const t = ctx.text;
    if (t.length > 90) return null;
    if (!/\b(?:weather|forecast|temperature|raining|snowing|rain|snow|umbrella|how (?:hot|cold|warm) is it|is it (?:hot|cold|warm|sunny|cloudy|windy|humid))\b/.test(t)) return null;
    if (/\b(?:remind|timer|note|task)\b/.test(t)) return null;
    const loc = ctx.original.match(
      /\b(?:in|for|at|near)\s+([a-z][a-z .'-]{1,40}?)(?:\s+(?:today|tomorrow|tonight|this week|this weekend|right now|now|currently|like|please))?$/i,
    );
    const place = (loc?.[1] ?? ctx.settings.location).trim();
    if (!place || /^(?:the|my|me|this)$/i.test(place)) {
      return {
        skill: "weather",
        reply: `Which city, ${ctx.addr}? You can also say "set my location to Paris" and I'll default to it from now on.`,
      };
    }
    const focus = /\btomorrow\b/.test(t) ? "tomorrow" : /\b(?:week|forecast|weekend|next few days)\b/.test(t) ? "week" : "now";
    try {
      const w = await getWeather(place, ctx.settings.units);
      let reply = describeWeather(w, focus);
      if (/\b(?:rain|raining|umbrella|snow|snowing)\b/.test(t)) {
        const pop = (focus === "tomorrow" ? w.days[1] : w.days[0]).pop;
        const lead = pop >= 60 ? "Yes — an umbrella would be wise." : pop >= 30 ? "Possibly — I'd keep an umbrella handy." : "Unlikely.";
        reply = `${lead} ${reply}`;
      }
      return { skill: "weather", reply };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/couldn't find a place/.test(msg)) return { skill: "weather", reply: `${msg}. Could you try the nearest major city?` };
      return { skill: "weather", reply: "I couldn't reach the weather service just now. Live weather needs an internet connection." };
    }
  },
};

// ---------------------------------------------------------------------------
// Knowledge (Wikipedia / dictionary) — yields to cloud brain when linked
// ---------------------------------------------------------------------------

export const defineSkill: Skill = {
  name: "define",
  knowledge: true,
  async run(ctx) {
    const m =
      ctx.original.match(/^(?:define|definition of|meaning of|what'?s the meaning of|what is the definition of|what is the meaning of)\s+(?:the word\s+)?([a-z'-]+)$/i) ??
      ctx.original.match(/^what does\s+([a-z'-]+)\s+mean$/i);
    if (!m) return null;
    try {
      const d = await defineWord(m[1]);
      if (!d) return { skill: "define", reply: `I couldn't find a definition for "${m[1]}".` };
      return {
        skill: "define",
        reply: `${d.word}${d.phonetic ? ` ${d.phonetic}` : ""}${d.partOfSpeech ? ` (${d.partOfSpeech})` : ""}: ${d.definition}${d.example ? `\nExample: “${d.example}”` : ""}`,
      };
    } catch {
      return { skill: "define", reply: "My dictionary archives need an internet connection, and I can't reach them right now." };
    }
  },
};

const LOOKUP_RE =
  /^(?:who (?:is|was|are|were)|what (?:is|are|was|were)|what'?s|whats|tell me (?:more )?about|explain|wikipedia|wiki|look up|lookup|search(?: for| wikipedia for)?|google|info on|information (?:on|about)|learn about|describe)\s+(.+)$/i;

export const lookupSkill: Skill = {
  name: "lookup",
  knowledge: true,
  async run(ctx) {
    const m = ctx.original.match(LOOKUP_RE);
    if (!m) return null;
    let topic = m[1]
      .replace(/^(?:an?|the)\s+/i, "")
      .replace(/^(?:meant by|meaning of)\s+/i, "")
      .replace(/\s+(?:mean|means)$/i, "")
      .trim();
    if (!topic) return null;
    if (/^(?:my|your|you\b|me\b|i\b|it\b|this\b|that\b|up\b|going on|happening|new\b|wrong|today|tomorrow|time\b|date\b|weather|day\b)/i.test(topic)) return null;
    if (topic.split(/\s+/).length > 6) return null;
    try {
      const r = await wikiLookup(topic);
      if (!r) return { skill: "lookup", reply: `I couldn't find anything on "${topic}", ${ctx.addr}.` };
      if (r.disambiguation) return { skill: "lookup", reply: `"${r.title}" could refer to several things. Could you be more specific?` };
      topic = r.title;
      const body = firstSentences(r.extract, 3);
      if (/^list of\b/i.test(r.title)) return { skill: "lookup", reply: body };
      return { skill: "lookup", reply: `${r.title}${r.description ? ` — ${r.description}` : ""}.\n${body}` };
    } catch {
      return { skill: "lookup", reply: "My knowledge archives need an internet connection, and I can't reach them right now. A linked cloud brain would help here." };
    }
  },
};

// ---------------------------------------------------------------------------
// System status, briefing, utilities
// ---------------------------------------------------------------------------

export const systemSkill: Skill = {
  name: "status",
  async run(ctx) {
    if (
      !/^(?:run (?:a |the )?(?:full )?(?:system )?(?:diagnostics?|self[- ]?(?:test|check)|health check)|(?:system|systems|status|diagnostic|diagnostics)(?: status| report| check)?|status report|sitrep|how are your systems(?: doing| looking)?|are (?:you|your systems) (?:online|working|operational|ok|okay)|health check)$/.test(
        ctx.text,
      )
    )
      return null;
    const st = await collectStatus();
    const cloud = ctx.cloudAvailable ? `linked — ${ctx.provider} · ${ctx.model}` : "not linked (running on local core)";
    return {
      skill: "status",
      reply: [
        `Diagnostics complete, ${ctx.addr}. All primary systems nominal.`,
        bullets([
          `Local core: online — ${ctx.skillCount} skills loaded`,
          `Cloud brain: ${cloud}`,
          `Mode: ${ctx.settings.brainMode}`,
          `Database: online (${st.dbMs} ms)`,
          `Server: up ${humanDuration(st.uptimeSec)} · ${st.rssMb} MB`,
          `Data: ${plural(st.stats.openTasks, "open task")} · ${plural(st.stats.notes, "note")} · ${plural(st.stats.pendingReminders, "pending alert")} · ${plural(st.stats.memories, "memory", "memories")}`,
        ]),
      ].join("\n"),
    };
  },
};

async function briefingText(ctx: SkillContext): Promise<string> {
  const p = zparts(ctx.now, ctx.tz);
  const [open, pending] = await Promise.all([openTasks(), pendingReminders()]);
  const lines: string[] = [`Good ${partOfDay(p.hour)}, ${ctx.addr}. It's ${fmtTime(ctx.now, ctx.tz)} on ${fmtDate(ctx.now, ctx.tz)}.`];

  if (ctx.settings.location) {
    try {
      const w = await getWeather(ctx.settings.location, ctx.settings.units);
      const d = w.days[0];
      lines.push(`Weather in ${w.place}: ${w.current.temp}${w.unitTemp} and ${w.current.desc}, high of ${d.hi}${w.unitTemp}, ${d.pop}% chance of precipitation.`);
    } catch {
      /* offline — skip weather */
    }
  }

  if (open.length) {
    const top = open.slice(0, 5).map((t) => `${t.title}${t.priority === "high" ? " ❗" : ""}${t.dueAt ? ` — due ${fmtWhen(new Date(t.dueAt), ctx.now, ctx.tz)}` : ""}`);
    lines.push(`You have ${plural(open.length, "open task")}:\n${bullets(top)}${open.length > 5 ? `\n…and ${open.length - 5} more.` : ""}`);
  } else lines.push("Your task list is clear.");

  if (pending.length) {
    const next = pending.slice(0, 4).map((r) => `${r.kind === "timer" ? "⏱" : "⏰"} ${r.label} — ${fmtWhen(new Date(r.dueAt), ctx.now, ctx.tz)}`);
    lines.push(`Upcoming alerts:\n${bullets(next)}`);
  } else lines.push("No reminders or timers pending.");
  return lines.join("\n\n");
}

export const briefingSkill: Skill = {
  name: "briefing",
  async run(ctx) {
    if (
      !/^(?:(?:give me|run|start|do|read)\s+(?:me\s+)?(?:my|a|the)\s+)?(?:daily |morning |evening |afternoon )?(?:briefing|rundown|run down|agenda)$|^brief me$|^catch me up$|^what'?s (?:on )?(?:my )?(?:plate|agenda|schedule|day|calendar)(?: today| like today)?$|^what do i have (?:to do )?(?:today|on)$|^how'?s my day(?: looking| shaping up)?$|^what'?s on today$|^what'?s up for today$/.test(
        ctx.text,
      )
    )
      return null;
    return { skill: "briefing", reply: await briefingText(ctx) };
  },
};

const PW_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+?";

export const passwordSkill: Skill = {
  name: "password",
  run(ctx) {
    if (!/\b(?:generate|make|create|give me)\b.*\bpassword\b/.test(ctx.text)) return null;
    const len = Math.min(64, Math.max(8, Number(ctx.text.match(/(\d{1,3})/)?.[1] ?? 16)));
    let pw = "";
    for (let i = 0; i < len; i++) pw += PW_CHARS[randomInt(PW_CHARS.length)];
    return { skill: "password", reply: `Here's a ${len}-character password, generated locally and not stored anywhere:\n${pw}` };
  },
};
