// Offline unit conversion.

interface Unit {
  cat: string;
  label: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const table = new Map<string, Unit>();

function add(cat: string, label: string, aliases: string[], factor: number) {
  const u: Unit = { cat, label, toBase: (v) => v * factor, fromBase: (v) => v / factor };
  for (const a of aliases) table.set(a, u);
}

function addCustom(cat: string, label: string, aliases: string[], toBase: (v: number) => number, fromBase: (v: number) => number) {
  const u: Unit = { cat, label, toBase, fromBase };
  for (const a of aliases) table.set(a, u);
}

// length (base: metre)
add("length", "meters", ["m", "meter", "meters", "metre", "metres"], 1);
add("length", "kilometers", ["km", "kms", "kilometer", "kilometers", "kilometre", "kilometres", "klick", "klicks"], 1000);
add("length", "centimeters", ["cm", "centimeter", "centimeters", "centimetre", "centimetres"], 0.01);
add("length", "millimeters", ["mm", "millimeter", "millimeters", "millimetre", "millimetres"], 0.001);
add("length", "miles", ["mi", "mile", "miles"], 1609.344);
add("length", "yards", ["yd", "yds", "yard", "yards"], 0.9144);
add("length", "feet", ["ft", "foot", "feet"], 0.3048);
add("length", "inches", ["in", "inch", "inches"], 0.0254);
add("length", "nautical miles", ["nmi", "nautical mile", "nautical miles"], 1852);
// mass (base: kilogram)
add("mass", "kilograms", ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"], 1);
add("mass", "grams", ["g", "gram", "grams", "gm"], 0.001);
add("mass", "milligrams", ["mg", "milligram", "milligrams"], 0.000001);
add("mass", "pounds", ["lb", "lbs", "pound", "pounds"], 0.45359237);
add("mass", "ounces", ["oz", "ounce", "ounces"], 0.028349523125);
add("mass", "stone", ["st", "stone", "stones"], 6.35029318);
add("mass", "metric tons", ["tonne", "tonnes", "metric ton", "metric tons"], 1000);
add("mass", "US tons", ["ton", "tons"], 907.18474);
// volume (base: litre)
add("volume", "liters", ["l", "liter", "liters", "litre", "litres"], 1);
add("volume", "milliliters", ["ml", "milliliter", "milliliters", "millilitre", "millilitres"], 0.001);
add("volume", "US gallons", ["gal", "gallon", "gallons"], 3.785411784);
add("volume", "quarts", ["qt", "quart", "quarts"], 0.946352946);
add("volume", "pints", ["pt", "pint", "pints"], 0.473176473);
add("volume", "cups", ["cup", "cups"], 0.2365882365);
add("volume", "fluid ounces", ["fl oz", "floz", "fluid ounce", "fluid ounces"], 0.0295735295625);
add("volume", "tablespoons", ["tbsp", "tablespoon", "tablespoons"], 0.01478676478125);
add("volume", "teaspoons", ["tsp", "teaspoon", "teaspoons"], 0.00492892159375);
// speed (base: m/s)
add("speed", "meters per second", ["m/s", "mps", "meters per second"], 1);
add("speed", "kilometers per hour", ["km/h", "kmh", "kph", "kmph", "kilometers per hour"], 1 / 3.6);
add("speed", "miles per hour", ["mph", "mi/h", "miles per hour"], 0.44704);
add("speed", "knots", ["kt", "kts", "knot", "knots"], 0.514444);
add("speed", "feet per second", ["fps", "ft/s", "feet per second"], 0.3048);
// area (base: m²)
add("area", "square meters", ["sqm", "m2", "m²", "sq m", "sq meter", "sq meters", "square meter", "square meters"], 1);
add("area", "square kilometers", ["sqkm", "km2", "km²", "sq km", "square kilometer", "square kilometers"], 1e6);
add("area", "square feet", ["sqft", "ft2", "ft²", "sq ft", "square foot", "square feet"], 0.09290304);
add("area", "square miles", ["sqmi", "sq mi", "square mile", "square miles"], 2589988.110336);
add("area", "acres", ["acre", "acres"], 4046.8564224);
add("area", "hectares", ["ha", "hectare", "hectares"], 10000);
// time (base: second)
add("time", "seconds", ["s", "sec", "secs", "second", "seconds"], 1);
add("time", "minutes", ["min", "mins", "minute", "minutes"], 60);
add("time", "hours", ["h", "hr", "hrs", "hour", "hours"], 3600);
add("time", "days", ["day", "days"], 86400);
add("time", "weeks", ["wk", "wks", "week", "weeks"], 604800);
add("time", "years", ["yr", "yrs", "year", "years"], 31557600);
// data (base: byte) — binary multiples
add("data", "bytes", ["b", "byte", "bytes"], 1);
add("data", "kilobytes", ["kb", "kilobyte", "kilobytes"], 1024);
add("data", "megabytes", ["mb", "megabyte", "megabytes"], 1024 ** 2);
add("data", "gigabytes", ["gb", "gigabyte", "gigabytes"], 1024 ** 3);
add("data", "terabytes", ["tb", "terabyte", "terabytes"], 1024 ** 4);
// temperature (base: °C)
addCustom("temp", "°C", ["c", "°c", "celsius", "centigrade", "degrees celsius", "degrees c"], (v) => v, (v) => v);
addCustom("temp", "°F", ["f", "°f", "fahrenheit", "degrees fahrenheit", "degrees f"], (v) => ((v - 32) * 5) / 9, (v) => (v * 9) / 5 + 32);
addCustom("temp", "K", ["k", "kelvin"], (v) => v - 273.15, (v) => v + 273.15);

function lookup(name: string): Unit | null {
  const n = name
    .toLowerCase()
    .trim()
    .replace(/^(?:a|an|the|one)\s+/, "")
    .replace(/\s+/g, " ")
    .replace(/^square /, "sq ")
    .replace(/\.$/, "");
  return table.get(n) ?? table.get(name.toLowerCase().trim()) ?? null;
}

export interface Conversion {
  value: number;
  from: string;
  to: string;
  result: number;
}

export function convertUnits(value: number, from: string, to: string): Conversion | "mismatch" | null {
  const a = lookup(from);
  const b = lookup(to);
  if (!a || !b) return null;
  if (a.cat !== b.cat) return "mismatch";
  return { value, from: a.label, to: b.label, result: b.fromBase(a.toBase(value)) };
}

/** Parse phrases like "convert 5 miles to km", "72 f in c", "how many cm in 3 inches". */
export function parseConversion(text: string): { value: number; from: string; to: string } | null {
  let s = text
    .toLowerCase()
    .replace(/[?]+$/g, "")
    .replace(/^(?:what(?:'s| is)|whats|how much is|convert|tell me)\s+/, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .trim();

  let m = s.match(/^how many\s+(.+?)\s+(?:are\s+|is\s+)?(?:there\s+)?in\s+(?:(?:an?|one)\s+|(-?\d+(?:\.\d+)?)\s*)?(.+)$/);
  if (m) return { value: m[2] ? Number(m[2]) : 1, from: m[3], to: m[1] };

  s = s.replace(/°\s*/g, "°");
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*([a-z°²/ ]+?)\s+(?:to|in|into|as)\s+([a-z°²/ ]+)$/);
  if (m) return { value: Number(m[1]), from: m[2], to: m[3] };
  return null;
}

export const CURRENCY_ALIASES: Record<string, string> = {
  usd: "USD", dollar: "USD", dollars: "USD", bucks: "USD", "us dollars": "USD",
  eur: "EUR", euro: "EUR", euros: "EUR",
  gbp: "GBP", pound: "GBP", pounds: "GBP", sterling: "GBP", quid: "GBP",
  jpy: "JPY", yen: "JPY", cad: "CAD", aud: "AUD", chf: "CHF", francs: "CHF",
  cny: "CNY", yuan: "CNY", rmb: "CNY", inr: "INR", rupee: "INR", rupees: "INR",
  mxn: "MXN", pesos: "MXN", brl: "BRL", real: "BRL", reais: "BRL", krw: "KRW", won: "KRW",
  sek: "SEK", nok: "NOK", dkk: "DKK", nzd: "NZD", sgd: "SGD", hkd: "HKD", zar: "ZAR",
  try: "TRY", lira: "TRY", pln: "PLN", zloty: "PLN", thb: "THB", baht: "THB", aed: "AED", dirham: "AED",
};
