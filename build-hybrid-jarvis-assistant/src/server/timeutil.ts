// Timezone-aware date helpers and natural-language time parsing (no dependencies).

export const DEFAULT_TZ = "UTC";

export function safeTz(tz?: string | null): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export interface ZParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function zparts(date: Date, tz: string): ZParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of f.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: Math.max(0, WD.indexOf(map.weekday)),
  };
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = zparts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in `tz` into an absolute instant. Day/month overflow is allowed. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

export function fmtTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}

export function fmtDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function fmtShortDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
}

function dayNumber(d: Date, tz: string): number {
  const p = zparts(d, tz);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86400000);
}

/** "today at 5:00 PM", "tomorrow at 9:00 AM", "Mon, Mar 9 at 5:00 PM" */
export function fmtWhen(d: Date, now: Date, tz: string): string {
  const diff = dayNumber(d, tz) - dayNumber(now, tz);
  const t = fmtTime(d, tz);
  if (diff === 0) return `today at ${t}`;
  if (diff === 1) return `tomorrow at ${t}`;
  if (diff === -1) return `yesterday at ${t}`;
  return `${fmtShortDay(d, tz)} at ${t}`;
}

export function humanDuration(totalSeconds: number): string {
  let s = Math.max(0, Math.round(totalSeconds));
  if (s < 1) return "moments";
  const units: [string, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const parts: string[] = [];
  for (const [name, size] of units) {
    const n = Math.floor(s / size);
    if (n > 0) {
      parts.push(`${n} ${name}${n === 1 ? "" : "s"}`);
      s -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Duration parsing: "10 minutes", "an hour and a half", "1 hour 30 minutes"
// ---------------------------------------------------------------------------

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, fifty: 50,
  sixty: 60, ninety: 90,
};

const UNIT_SECONDS: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
  week: 604800, weeks: 604800,
};

const NUM_ALT = "\\d+(?:\\.\\d+)?|half an?|" + Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join("|");
const UNIT_LONG = "seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?";

export interface DurationResult {
  seconds: number;
  /** Text with the matched duration (and its preposition) removed. */
  rest: string;
  /** Whether the duration was introduced by in/after/for or followed by "from now". */
  anchored: boolean;
}

export function parseDuration(text: string, opts: { shorthand?: boolean } = {}): DurationResult | null {
  const chunks: { start: number; end: number; seconds: number }[] = [];
  const re = new RegExp(`\\b(${NUM_ALT})\\s*(${UNIT_LONG})\\b(\\s+and\\s+a\\s+half\\b)?`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rawNum = m[1].toLowerCase();
    const n = rawNum.startsWith("half") ? 0.5 : /^\d/.test(rawNum) ? Number(rawNum) : NUM_WORDS[rawNum];
    const unit = UNIT_SECONDS[m[2].toLowerCase().replace(/s$/, "")] ?? UNIT_SECONDS[m[2].toLowerCase()];
    if (n === undefined || !unit) continue;
    let seconds = n * unit;
    if (m[3]) seconds += unit / 2;
    chunks.push({ start: m.index, end: m.index + m[0].length, seconds });
  }
  if (!chunks.length && opts.shorthand) {
    const sre = /\b(\d+(?:\.\d+)?)\s?(h|hr|hrs|m|min|mins|s|sec|secs)\b/gi;
    while ((m = sre.exec(text))) {
      const unit = UNIT_SECONDS[m[2].toLowerCase()];
      chunks.push({ start: m.index, end: m.index + m[0].length, seconds: Number(m[1]) * unit });
    }
  }
  if (!chunks.length) return null;

  // Merge adjacent chunks ("1 hour and 30 minutes").
  let end = chunks[0].end;
  let total = chunks[0].seconds;
  for (let i = 1; i < chunks.length; i++) {
    const gap = text.slice(end, chunks[i].start);
    if (/^\s*(?:,|and|&)?\s*$/i.test(gap)) {
      total += chunks[i].seconds;
      end = chunks[i].end;
    } else break;
  }
  let start = chunks[0].start;
  let anchored = false;
  const before = text.slice(0, start);
  const prep = before.match(/\b(in|after|for|within)\s*$/i);
  if (prep) {
    start -= prep[0].length;
    anchored = true;
  }
  const after = text.slice(end);
  const fromNow = after.match(/^\s*(?:from now|later)\b/i);
  if (fromNow) {
    end += fromNow[0].length;
    anchored = true;
  }
  const rest = (text.slice(0, start) + " " + text.slice(end)).replace(/\s+/g, " ").trim();
  return { seconds: total, rest, anchored };
}

// ---------------------------------------------------------------------------
// Absolute / relative "when" parsing for reminders and tasks
// ---------------------------------------------------------------------------

export interface WhenResult {
  date: Date;
  rest: string;
  relative: boolean;
}

const DAY_RE = new RegExp(
  "\\b(day after tomorrow|tomorrow(?:\\s+(?:morning|afternoon|evening|night))?|today|tonight|this (?:morning|afternoon|evening)|(?:(?:next|on|this|coming)\\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\\b",
  "i",
);

interface ClockMatch {
  hour: number;
  minute: number;
  text: string;
  ambiguous: boolean;
}

function matchClock(text: string): ClockMatch | null {
  let m = text.match(/\b(?:at\s+)?(noon|midnight)\b/i);
  if (m) return { hour: m[1].toLowerCase() === "noon" ? 12 : 0, minute: 0, text: m[0], ambiguous: false };

  const to24 = (h: number, mer: string | undefined) => {
    if (!mer) return h;
    const pm = mer.toLowerCase().startsWith("p");
    if (pm && h < 12) return h + 12;
    if (!pm && h === 12) return 0;
    return h;
  };

  m = text.match(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d:])/i);
  if (m) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h <= 24 && min < 60) {
      return { hour: to24(h, m[3]), minute: min, text: m[0], ambiguous: !m[3] && h <= 12 && h !== 0 };
    }
  }
  m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i);
  if (m) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h >= 1 && h <= 12 && min < 60) return { hour: to24(h, m[3]), minute: min, text: m[0], ambiguous: false };
  }
  m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { hour: Number(m[1]), minute: Number(m[2]), text: m[0], ambiguous: false };
  return null;
}

export function parseWhen(text: string, now: Date, tz: string): WhenResult | null {
  // 1) Relative: "in 10 minutes", "after 2 hours", "5 minutes from now"
  const dur = parseDuration(text);
  if (dur && dur.anchored && dur.seconds > 0) {
    return { date: new Date(now.getTime() + dur.seconds * 1000), rest: dur.rest, relative: true };
  }

  // 2) Absolute: day word and/or clock time
  const dayM = text.match(DAY_RE);
  const clock = matchClock(text);
  if (!dayM && !clock) return null;

  const np = zparts(now, tz);
  let offsetDays = 0;
  let defHour = 9;
  let dayWord = "";
  if (dayM) {
    dayWord = dayM[1].toLowerCase();
    if (dayWord.startsWith("day after")) offsetDays = 2;
    else if (dayWord.startsWith("tomorrow")) {
      offsetDays = 1;
      if (/afternoon/.test(dayWord)) defHour = 15;
      else if (/evening/.test(dayWord)) defHour = 18;
      else if (/night/.test(dayWord)) defHour = 20;
    } else if (dayWord === "today") offsetDays = 0;
    else if (dayWord === "tonight") defHour = 20;
    else if (dayWord.startsWith("this ")) {
      if (/afternoon/.test(dayWord)) defHour = 15;
      else if (/evening/.test(dayWord)) defHour = 18;
    } else {
      const wdName = WEEKDAY_NAMES.find((n) => dayWord.endsWith(n));
      if (wdName) {
        const target = WEEKDAY_NAMES.indexOf(wdName);
        offsetDays = (target - np.weekday + 7) % 7;
        if (offsetDays === 0) offsetDays = 7;
        if (/^next\b/.test(dayWord) && offsetDays <= 0) offsetDays += 7;
      }
    }
  }

  let hour = clock ? clock.hour : defHour;
  const minute = clock ? clock.minute : 0;
  if (clock?.ambiguous) {
    if (dayWord === "tonight" || /evening|night/.test(dayWord)) {
      if (hour < 12) hour += 12;
    } else if (dayM) {
      if (hour >= 1 && hour <= 6) hour += 12; // "tomorrow at 5" => 5 PM
    } else {
      // Pick the next upcoming occurrence of this clock time (AM or PM).
      const base = hour % 12;
      const candidates = [base, base + 12].map((h) => zonedToUtc(np.year, np.month, np.day, h, minute, tz));
      const upcoming = candidates.find((c) => c.getTime() > now.getTime());
      hour = upcoming ? (upcoming === candidates[0] ? base : base + 12) : base;
    }
  } else if (!clock && dayWord === "tonight") hour = 20;

  let date = zonedToUtc(np.year, np.month, np.day + offsetDays, hour, minute, tz);
  if (!dayM && date.getTime() <= now.getTime()) {
    date = zonedToUtc(np.year, np.month, np.day + 1, hour, minute, tz);
  }

  let rest = text;
  if (dayM) rest = rest.replace(dayM[0], " ");
  if (clock) rest = rest.replace(clock.text, " ");
  rest = rest.replace(/\s+/g, " ").trim();
  return { date, rest, relative: false };
}

// ---------------------------------------------------------------------------
// City -> IANA timezone (small offline table)
// ---------------------------------------------------------------------------

export const CITY_TZ: Record<string, string> = {
  tokyo: "Asia/Tokyo", japan: "Asia/Tokyo", osaka: "Asia/Tokyo",
  london: "Europe/London", uk: "Europe/London", england: "Europe/London", "united kingdom": "Europe/London",
  "new york": "America/New_York", nyc: "America/New_York", boston: "America/New_York", miami: "America/New_York",
  washington: "America/New_York", atlanta: "America/New_York", est: "America/New_York", eastern: "America/New_York",
  chicago: "America/Chicago", dallas: "America/Chicago", houston: "America/Chicago", cst: "America/Chicago",
  denver: "America/Denver", mst: "America/Denver",
  "los angeles": "America/Los_Angeles", la: "America/Los_Angeles", "san francisco": "America/Los_Angeles",
  seattle: "America/Los_Angeles", "las vegas": "America/Los_Angeles", pst: "America/Los_Angeles", pacific: "America/Los_Angeles",
  phoenix: "America/Phoenix", honolulu: "Pacific/Honolulu", hawaii: "Pacific/Honolulu", anchorage: "America/Anchorage",
  toronto: "America/Toronto", vancouver: "America/Vancouver", montreal: "America/Toronto",
  "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo", "são paulo": "America/Sao_Paulo",
  "rio de janeiro": "America/Sao_Paulo", "buenos aires": "America/Argentina/Buenos_Aires", bogota: "America/Bogota",
  lima: "America/Lima", santiago: "America/Santiago",
  paris: "Europe/Paris", france: "Europe/Paris", berlin: "Europe/Berlin", germany: "Europe/Berlin",
  madrid: "Europe/Madrid", spain: "Europe/Madrid", rome: "Europe/Rome", italy: "Europe/Rome",
  amsterdam: "Europe/Amsterdam", brussels: "Europe/Brussels", vienna: "Europe/Vienna", zurich: "Europe/Zurich",
  stockholm: "Europe/Stockholm", oslo: "Europe/Oslo", copenhagen: "Europe/Copenhagen", helsinki: "Europe/Helsinki",
  warsaw: "Europe/Warsaw", prague: "Europe/Prague", athens: "Europe/Athens", lisbon: "Europe/Lisbon",
  dublin: "Europe/Dublin", istanbul: "Europe/Istanbul", moscow: "Europe/Moscow", kyiv: "Europe/Kyiv",
  cairo: "Africa/Cairo", johannesburg: "Africa/Johannesburg", "cape town": "Africa/Johannesburg",
  lagos: "Africa/Lagos", nairobi: "Africa/Nairobi", casablanca: "Africa/Casablanca",
  dubai: "Asia/Dubai", "abu dhabi": "Asia/Dubai", riyadh: "Asia/Riyadh", tehran: "Asia/Tehran",
  karachi: "Asia/Karachi", mumbai: "Asia/Kolkata", delhi: "Asia/Kolkata", "new delhi": "Asia/Kolkata",
  india: "Asia/Kolkata", bangalore: "Asia/Kolkata", kolkata: "Asia/Kolkata", dhaka: "Asia/Dhaka",
  bangkok: "Asia/Bangkok", jakarta: "Asia/Jakarta", singapore: "Asia/Singapore", "kuala lumpur": "Asia/Kuala_Lumpur",
  manila: "Asia/Manila", "hong kong": "Asia/Hong_Kong", shanghai: "Asia/Shanghai", beijing: "Asia/Shanghai",
  china: "Asia/Shanghai", taipei: "Asia/Taipei", seoul: "Asia/Seoul", korea: "Asia/Seoul",
  sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", brisbane: "Australia/Brisbane",
  perth: "Australia/Perth", auckland: "Pacific/Auckland", "new zealand": "Pacific/Auckland",
  utc: "UTC", gmt: "UTC", zulu: "UTC",
};
