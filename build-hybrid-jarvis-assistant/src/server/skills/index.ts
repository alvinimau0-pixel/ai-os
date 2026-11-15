import type { SettingsDTO } from "@/lib/types";
import { escapeRe, type Skill, type SkillContext, type SkillResult } from "./core";
import { funSkill, greetingSkill, helpSkill, identitySkill, randomSkill, smalltalkSkill } from "./conversation";
import {
  briefingSkill,
  countdownSkill,
  currencySkill,
  dateSkill,
  defineSkill,
  lookupSkill,
  mathSkill,
  passwordSkill,
  systemSkill,
  timeSkill,
  unitsSkill,
  weatherSkill,
} from "./info";
import { memorySkill, notesSkill, preferencesSkill, remindersSkill, tasksSkill } from "./productivity";
import { calendarSkill, searchSkill, translateSkill } from "./connect";
import { routineSkill } from "./routine";

/** Order matters: more specific / action-oriented skills come first. */
export const SKILLS: Skill[] = [
  preferencesSkill,
  remindersSkill,
  tasksSkill,
  notesSkill,
  memorySkill,
  briefingSkill,
  systemSkill,
  weatherSkill,
  calendarSkill,
  searchSkill,
  translateSkill,
  routineSkill,
  timeSkill,
  dateSkill,
  countdownSkill,
  passwordSkill,
  randomSkill,
  mathSkill,
  unitsSkill,
  currencySkill,
  funSkill,
  greetingSkill,
  smalltalkSkill,
  identitySkill,
  helpSkill,
  defineSkill,
  lookupSkill,
];

export interface BuildContextInput {
  tz: string;
  now: Date;
  settings: SettingsDTO;
  cloud: { provider: string; model: string } | null;
}

/** Strip the wake word, polite filler and trailing punctuation, keeping the user's casing. */
export function buildContext(raw: string, input: BuildContextInput): SkillContext {
  const { settings, cloud } = input;
  let s = raw.trim().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");

  const names = Array.from(new Set([settings.wakeWord, settings.assistantName].map((n) => n.trim().toLowerCase()).filter(Boolean))).map(escapeRe);
  if (names.length) {
    s = s.replace(new RegExp(`^(?:(?:hey|hi|hello|ok|okay|yo)\\s+)?(?:${names.join("|")})\\b[\\s,.:!-]*`, "i"), "");
    s = s.replace(new RegExp(`[\\s,]+(?:${names.join("|")})[.!?]*$`, "i"), "");
  }
  s = s.replace(/^(?:(?:please|kindly)\s+)+/i, "");
  s = s.replace(/^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i(?:'d| would) like (?:you )?to\s+|i want you to\s+|i need you to\s+|go ahead and\s+|let'?s\s+)/i, "");
  const stripped = s.replace(/\s*,?\s*(?:please|for me|thanks|thank you)\s*[.!?]*$/i, "");
  if (stripped.trim()) s = stripped;
  s = s.replace(/^whats\b/i, "what's").replace(/[.!?]+$/g, "").trim();

  return {
    raw,
    original: s,
    text: s.toLowerCase(),
    tz: input.tz,
    now: input.now,
    settings,
    addr: settings.userName.trim() || "sir",
    cloudAvailable: !!cloud,
    provider: cloud?.provider ?? null,
    model: cloud?.model ?? null,
    skillCount: SKILLS.length,
  };
}

/** Commands that control the assistant itself — always handled locally, even in cloud-first mode. */
export const CONTROL_SKILLS: Skill[] = [preferencesSkill];

export async function runSkills(ctx: SkillContext, opts: { skipKnowledge: boolean; only?: Skill[] }): Promise<SkillResult | null> {
  for (const skill of opts.only ?? SKILLS) {
    if (skill.knowledge && opts.skipKnowledge) continue;
    try {
      const result = await skill.run(ctx);
      if (result) return result;
    } catch (err) {
      console.error(`[skill:${skill.name}]`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
