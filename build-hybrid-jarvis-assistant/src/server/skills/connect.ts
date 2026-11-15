// Connection skills: web search, translation and calendar (ICS feed).

import { searchWeb, translateText, fetchIcsEvents } from "../web";
import { fmtWhen } from "../timeutil";
import { cap, type Skill, type SkillContext } from "./core";

const LANG_CODES: Record<string, string> = {
  english: "en",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
  polish: "pl",
  russian: "ru",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  "chinese (simplified)": "zh-CN",
  "simplified chinese": "zh-CN",
  "traditional chinese": "zh-TW",
  arabic: "ar",
  hindi: "hi",
  turkish: "tr",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  finnish: "fi",
  greek: "el",
  hebrew: "he",
  thai: "th",
  vietnamese: "vi",
  indonesian: "id",
  czech: "cs",
  ukrainian: "uk",
  hungarian: "hu",
  romanian: "ro",
};

function langCode(name: string): string | null {
  const n = name.trim().toLowerCase().replace(/[.?!]/g, "");
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(n)) return n;
  return LANG_CODES[n] ?? null;
}

// ----------------------------- Calendar ------------------------------------

export const calendarSkill: Skill = {
  name: "calendar",
  async run(ctx) {
    const t = ctx.text;
    if (!/\b(?:calendar|agenda|schedule|upcoming events?|what'?s on my calendar|events? today|appointments?)\b/.test(t)) return null;
    if (/\b(?:weather|remind|timer|task|note)\b/.test(t)) return null;
    const url = process.env.CALENDAR_ICS_URL?.trim();
    if (!url) {
      return {
        skill: "calendar",
        reply: `I don't have a calendar feed yet, ${ctx.addr}. Set CALENDAR_ICS_URL in the server environment (any .ics link) and I'll list upcoming events.`,
      };
    }
    try {
      const events = await fetchIcsEvents(url, 8);
      if (!events.length) return { skill: "calendar", reply: `Nothing scheduled on your calendar, ${ctx.addr}.` };
      const lines = events.map((e) => `• ${fmtWhen(e.start, ctx.now, ctx.tz)}${e.location ? ` — ${e.location}` : ""}: ${e.summary}`);
      return { skill: "calendar", reply: `Here's what's coming up:\n${lines.join("\n")}` };
    } catch {
      return { skill: "calendar", reply: "I couldn't reach the calendar feed right now." };
    }
  },
};

// ----------------------------- Web search ----------------------------------

const SEARCH_RE =
  /^(?:search the web(?: for)?|search online(?: for)?|web search(?: for)?|search google(?: for)?|look (?:it|this) up online|find (?:this|it|me) online|on the internet(?: search)?)\s+(.+)$/i;

export const searchSkill: Skill = {
  name: "search",
  async run(ctx) {
    const m = ctx.original.match(SEARCH_RE);
    if (!m) return null;
    const q = m[1].replace(/[.?!]+$/, "").trim();
    if (!q) return null;
    try {
      const results = await searchWeb(q, 5);
      if (!results.length) return { skill: "search", reply: `I couldn't find anything for "${q}", ${ctx.addr}.` };
      const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`);
      return { skill: "search", reply: `Top results for "${cap(q)}":\n${lines.join("\n")}` };
    } catch {
      return { skill: "search", reply: "The search service is unreachable right now." };
    }
  },
};

// ----------------------------- Translation ---------------------------------

const TRANSLATE_RE = /^(?:translate|translation of|translate this)\s+(.+)$/i;

export const translateSkill: Skill = {
  name: "translate",
  async run(ctx) {
    const m = ctx.original.match(TRANSLATE_RE);
    if (!m) return null;
    let rest = m[1].replace(/[.?!]+$/, "").trim();
    if (!rest) return null;
    let target: string | null = null;
    const t = rest.match(/\s+(?:to|into|in)\s+([a-z][a-z ()/-]*)$/i);
    if (t) {
      target = langCode(t[1]);
      rest = rest.slice(0, t.index).trim();
    }
    if (!rest) return null;
    if (!target) {
      return { skill: "translate", reply: `Translate into which language? Try "translate ${rest} to Spanish".` };
    }
    try {
      const out = await translateText(rest, target);
      return { skill: "translate", reply: `In ${cap(t![1].trim())}: ${out}` };
    } catch {
      return { skill: "translate", reply: "The translation service is unreachable right now." };
    }
  },
};
