// Keyless public APIs used by the local core: weather, Wikipedia, dictionary, currency.

import type { Units } from "@/lib/types";

const UA = "JarvisAssistant/1.0 (personal AI assistant)";

async function getJson<T>(url: string, timeoutMs = 6000, headers?: Record<string, string>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------- Weather -------------------------------------

const WMO: Record<number, string> = {
  0: "clear skies", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "heavy freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers",
  82: "violent showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorms",
  96: "thunderstorms with hail", 99: "severe thunderstorms with hail",
};

export interface WeatherReport {
  place: string;
  current: { temp: number; feels: number; desc: string; humidity: number; wind: number; precip: number };
  days: { date: string; label: string; hi: number; lo: number; desc: string; pop: number }[];
  unitTemp: string;
  unitWind: string;
}

interface GeoResult {
  results?: { name: string; country?: string; admin1?: string; latitude: number; longitude: number }[];
}

async function geocode(q: string): Promise<GeoResult["results"] | null> {
  try {
    const geo = await getJson<GeoResult>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
    );
    return geo.results ?? null;
  } catch {
    return null;
  }
}

interface ForecastResult {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    precipitation: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

export async function getWeather(location: string, units: Units): Promise<WeatherReport> {
  // Try the full text first (it disambiguates "Springfield, IL"), then the
  // comma-stripped form if the geocoder dislikes qualifiers.
  let hit = (await geocode(location.trim()))?.[0];
  if (!hit && /,/.test(location)) hit = (await geocode(location.trim().replace(/,.*$/, "")))?.[0];
  if (!hit) throw new Error(`I couldn't find a place called "${location}"`);
  const imperial = units === "imperial";
  const f = await getJson<ForecastResult>(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=4&temperature_unit=${imperial ? "fahrenheit" : "celsius"}&wind_speed_unit=${imperial ? "mph" : "kmh"}`,
  );
  const labels = ["Today", "Tomorrow"];
  return {
    place: [hit.name, hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : null, hit.country].filter(Boolean).slice(0, 2).join(", "),
    unitTemp: imperial ? "°F" : "°C",
    unitWind: imperial ? "mph" : "km/h",
    current: {
      temp: Math.round(f.current.temperature_2m),
      feels: Math.round(f.current.apparent_temperature),
      desc: WMO[f.current.weather_code] ?? "unsettled conditions",
      humidity: Math.round(f.current.relative_humidity_2m),
      wind: Math.round(f.current.wind_speed_10m),
      precip: f.current.precipitation,
    },
    days: f.daily.time.map((date, i) => ({
      date,
      label: labels[i] ?? new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")),
      hi: Math.round(f.daily.temperature_2m_max[i]),
      lo: Math.round(f.daily.temperature_2m_min[i]),
      desc: WMO[f.daily.weather_code[i]] ?? "mixed conditions",
      pop: f.daily.precipitation_probability_max[i] ?? 0,
    })),
  };
}

export function describeWeather(w: WeatherReport, focus: "now" | "tomorrow" | "week" = "now"): string {
  const t = w.unitTemp;
  const c = w.current;
  const lines: string[] = [];
  if (focus === "now") {
    const today = w.days[0];
    lines.push(`Currently ${c.temp}${t} and ${c.desc} in ${w.place} (feels like ${c.feels}${t}).`);
    lines.push(`Today's range is ${today.lo}${t} to ${today.hi}${t} with a ${today.pop}% chance of precipitation. Wind ${c.wind} ${w.unitWind}, humidity ${c.humidity}%.`);
  } else if (focus === "tomorrow") {
    const d = w.days[1];
    lines.push(`Tomorrow in ${w.place}: ${d.desc}, between ${d.lo}${t} and ${d.hi}${t}, with a ${d.pop}% chance of precipitation.`);
  } else {
    lines.push(`Outlook for ${w.place}:`);
    for (const d of w.days) lines.push(`• ${d.label}: ${d.desc}, ${d.lo}–${d.hi}${t}, ${d.pop}% precipitation`);
  }
  return lines.join("\n");
}

// ----------------------------- Wikipedia -----------------------------------

export interface WikiResult {
  title: string;
  extract: string;
  description?: string;
  url?: string;
  disambiguation: boolean;
}

export function firstSentences(text: string, max = 3, maxChars = 480): string {
  const parts = text.replace(/\s+/g, " ").match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [text];
  let out = "";
  let n = 0;
  for (const p of parts) {
    if (out.length + p.length > maxChars && n > 0) break;
    out += p;
    n++;
    if (n >= max) break;
  }
  return out.trim();
}

export async function wikiLookup(topic: string): Promise<WikiResult | null> {
  const search = await getJson<{ pages?: { key: string; title: string }[] }>(
    `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(topic)}&limit=1`,
  );
  const page = search.pages?.[0];
  if (!page) return null;
  const sum = await getJson<{
    title: string;
    extract?: string;
    description?: string;
    type?: string;
    content_urls?: { desktop?: { page?: string } };
  }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`);
  if (!sum.extract) return null;
  return {
    title: sum.title,
    extract: sum.extract,
    description: sum.description,
    url: sum.content_urls?.desktop?.page,
    disambiguation: sum.type === "disambiguation",
  };
}

// ----------------------------- Dictionary ----------------------------------

export interface Definition {
  word: string;
  phonetic?: string;
  partOfSpeech?: string;
  definition: string;
  example?: string;
}

export async function defineWord(word: string): Promise<Definition | null> {
  try {
    const data = await getJson<
      {
        word: string;
        phonetic?: string;
        meanings?: { partOfSpeech?: string; definitions?: { definition: string; example?: string }[] }[];
      }[]
    >(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim().toLowerCase())}`);
    const entry = data[0];
    const meaning = entry?.meanings?.[0];
    const def = meaning?.definitions?.[0];
    if (!entry || !def) return null;
    return {
      word: entry.word,
      phonetic: entry.phonetic,
      partOfSpeech: meaning?.partOfSpeech,
      definition: def.definition,
      example: def.example,
    };
  } catch (err) {
    if (err instanceof Error && /HTTP 404/.test(err.message)) return null;
    throw err;
  }
}

// ----------------------------- Currency ------------------------------------

export async function convertCurrency(amount: number, from: string, to: string): Promise<{ result: number; rate: number; date: string }> {
  const data = await getJson<{ rates?: Record<string, number>; date?: string }>(
    `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
  );
  const rate = data.rates?.[to];
  if (!rate) throw new Error(`No exchange rate available for ${from} to ${to}`);
  return { result: amount * rate, rate, date: data.date ?? "" };
}

// ----------------------------- Web search ----------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Web search: Brave or Tavily when a key is set, keyless DuckDuckGo otherwise. */
export async function searchWeb(query: string, count = 5): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const braveKey = env("BRAVE_SEARCH_API_KEY");
  if (braveKey) {
    const data = await getJson<{ web: { results?: { title: string; url: string; description: string }[] } }>(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}`,
      8000,
      { "X-Subscription-Token": braveKey, Accept: "application/json" },
    );
    return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
  }
  const tavilyKey = env("TAVILY_API_KEY");
  if (tavilyKey) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: tavilyKey, query: q, max_results: count, include_answer: false }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 240) }));
  }
  // Keyless fallback: DuckDuckGo HTML endpoint, scraped for result blocks.
  const html = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`DuckDuckGo HTTP ${r.status}`))));
  const out: SearchResult[] = [];
  const re = /result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < count) {
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    const snippet = m[3].replace(/<[^>]+>/g, "").trim();
    let url = m[1];
    const udd = url.match(/uddg=([^&]+)/);
    if (udd) url = decodeURIComponent(udd[1]);
    if (title && url) out.push({ title, url, snippet });
  }
  return out;
}

// ----------------------------- Translation ---------------------------------

/** Translate via the keyless MyMemory API (5k chars/day anonymous quota). */
export async function translateText(text: string, target: string, source?: string): Promise<string> {
  const pair = `${(source ?? "auto").toLowerCase()}|${target.toLowerCase()}`;
  const data = await getJson<{ responseData?: { translatedText?: string }; responseStatus?: number }>(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 4500))}&langpair=${encodeURIComponent(pair)}`,
    8000,
  );
  const t = data.responseData?.translatedText;
  if (!t || data.responseStatus !== 200) throw new Error("Translation service returned no text");
  return t;
}

// ----------------------------- Calendar (ICS) ------------------------------

export interface IcsEvent {
  summary: string;
  start: Date;
  end: Date | null;
  location?: string;
  description?: string;
  allDay: boolean;
}

function unfoldIcs(raw: string): string[] {
  return raw.replace(/\r\n[\t ]/g, "").replace(/\n[\t ]/g, "").split(/\r?\n/);
}

function parseIcsDateTime(v: string): Date | null {
  const m = v.match(/^(\d{8})T(\d{6})Z?$/);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(4, 6));
  const d = Number(m[1].slice(6, 8));
  const hh = Number(m[2].slice(0, 2));
  const mi = Number(m[2].slice(2, 4));
  const ss = Number(m[2].slice(4, 6));
  return v.endsWith("Z") ? new Date(Date.UTC(y, mo - 1, d, hh, mi, ss)) : new Date(y, mo - 1, d, hh, mi, ss);
}

/** Fetch a remote .ics feed and return its events, soonest first. */
export async function fetchIcsEvents(url: string, limit = 10): Promise<IcsEvent[]> {
  const raw = await fetch(url.trim(), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000), cache: "no-store" }).then(
    (r) => (r.ok ? r.text() : Promise.reject(new Error(`ICS feed HTTP ${r.status}`))),
  );
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of unfoldIcs(raw)) {
    const [prop, ...rest] = line.split(":");
    const key = prop?.split(";")[0]?.toUpperCase();
    const val = rest.join(":");
    if (!key) continue;
    if (key === "BEGIN" && val.toUpperCase() === "VEVENT") cur = {};
    else if (key === "END" && val.toUpperCase() === "VEVENT") {
      if (cur && (cur.summary || cur.start)) events.push(cur as IcsEvent);
      cur = null;
    } else if (cur) {
      if (key === "SUMMARY") cur.summary = val;
      else if (key === "LOCATION") cur.location = val;
      else if (key === "DESCRIPTION") cur.description = val.slice(0, 300);
      else if (key === "DTSTART") {
        const d = parseIcsDateTime(val);
        if (d) {
          cur.start = d;
          cur.allDay = !val.includes("T");
        }
      } else if (key === "DTEND") {
        const d = parseIcsDateTime(val);
        if (d) cur.end = d;
      }
    }
  }
  return events
    .filter((e) => e.start)
    .sort((a, b) => (a.start as Date).getTime() - (b.start as Date).getTime())
    .slice(0, limit);
}
