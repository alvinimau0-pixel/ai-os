import type { ClientCommand, ResourceKey, SettingsDTO } from "@/lib/types";

export interface SkillContext {
  /** Exactly what the user typed/said. */
  raw: string;
  /** Cleaned (wake word + filler removed, trailing punctuation stripped), case preserved. */
  original: string;
  /** Lower-cased `original`. */
  text: string;
  tz: string;
  now: Date;
  settings: SettingsDTO;
  /** How to address the user: their name, or "sir". */
  addr: string;
  cloudAvailable: boolean;
  provider: string | null;
  model: string | null;
  skillCount: number;
}

export interface SkillResult {
  skill: string;
  reply: string;
  refresh?: ResourceKey[];
  client?: ClientCommand;
}

export interface Skill {
  name: string;
  /** Knowledge skills (encyclopedia lookups) yield to the cloud brain when it is available. */
  knowledge?: boolean;
  run: (ctx: SkillContext) => Promise<SkillResult | null> | SkillResult | null;
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function plural(n: number, word: string, pl?: string): string {
  return `${n} ${n === 1 ? word : (pl ?? word + "s")}`;
}

export function partOfDay(hour: number): "morning" | "afternoon" | "evening" | "night" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function bullets(items: string[]): string {
  return items.map((i) => `• ${i}`).join("\n");
}

/** Strip connector words and punctuation left over after extracting times/priorities. */
export function cleanFragment(input: string): string {
  let s = input.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s
      .replace(/^(?:to|that|about|of|and|for|on|at|by|in|,|:|-|;)\s+/i, "")
      .replace(/\s+(?:and|at|on|by|in|to|for|,|-)$/i, "")
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
      .trim();
    if (s === before) break;
  }
  return s;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
