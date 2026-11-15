import { listWorkflows, addWorkflow, deleteWorkflow, dueWorkflows, touchWorkflow, WorkflowDTO } from "../data";
import { type Skill, type SkillContext, cap } from "./core";
import { runSkills, buildContext } from "./index";

// ----------------------------- Routine (workflow) skill --------------------

const ROUTINE_RE = /^(?:create|add|make|set)\s+(?:a\s+)?routine\s+(?:"([^"]+)"|([^\s].+?))\s+(?:to|for)\s+(.+)$/i;
const RUN_ROUTINE_RE = /^(?:run|execute)\s+(?:routine\s+)?(?:(?:"([^"]+)"|(#\d+|\d+))|([^\s].+))$/i;
const DELETE_ROUTINE_RE = /^(?:delete|remove)\s+(?:routine\s+)?(?:(?:"([^"]+)"|(#\d+|\d+))|([^\s].+))$/i;
const LIST_ROUTINE_RE = /^(?:list|show)\s+routines$/i;

function extractIdOrName(match: string, fallback?: string): string | number | null {
  if (!match) return null;
  const num = match.match(/^#?(\d+)$/);
  if (num) return parseInt(num[1], 10);
  return match.trim().toLowerCase();
}

export const routineSkill: Skill = {
  name: "routine",
  async run(ctx) {
    const txt = ctx.original;
    let m: RegExpMatchArray | null;

    // create routine "trigger" to <prompt>
    if ((m = txt.match(ROUTINE_RE))) {
      const trigger = (m[1] || m[2] || "").trim();
      const prompt = (m[3] || "").trim();
      if (!trigger || !prompt) return null;
      try {
        const wf = await addWorkflow({ trigger, prompt, schedule: null });
        return {
          skill: "routine",
          reply: `Routine "${wf.trigger}" created (ID #${wf.id}). Say its trigger to run it.`,
          refresh: ["workflows"],
        };
      } catch (err: any) {
        return { skill: "routine", reply: `Couldn't create routine: ${err.message}` };
      }
    }

    // run routine "trigger" / run routine #3
    if ((m = txt.match(RUN_ROUTINE_RE))) {
      const ident = extractIdOrName(m[1] || m[2] || m[3] || "");
      if (!ident) return null;
      const workflows = await listWorkflows();
      let wf: WorkflowDTO | null = null;
      if (typeof ident === "number") {
        wf = workflows.find((w) => w.id === ident) || null;
      } else {
        wf = workflows.find((w) => w.trigger.toLowerCase() === ident.toLowerCase()) || null;
      }
      if (!wf) return { skill: "routine", reply: `No routine found with that name or ID.` };
      // Run the prompt through local skills (not cloud) so it can use local tools.
      const runCtx = buildContext(wf.prompt, {
        tz: ctx.tz,
        now: ctx.now,
        settings: ctx.settings,
        cloud: ctx.cloudAvailable ? { provider: ctx.provider!, model: ctx.model! } : null,
      });
      const result = await runSkills(runCtx, { skipKnowledge: false, only: undefined });
      await touchWorkflow(wf.id);
      if (result) {
        return { skill: "routine", reply: `⚙️ Routine "${wf.trigger}": ${result.reply}`, refresh: result.refresh };
      }
      return { skill: "routine", reply: `⚙️ Routine "${wf.trigger}" ran (no local skill handled it).` };
    }

    // delete routine "trigger" / delete routine #3
    if ((m = txt.match(DELETE_ROUTINE_RE))) {
      const ident = extractIdOrName(m[1] || m[2] || m[3] || "");
      if (!ident) return null;
      const workflows = await listWorkflows();
      let wf: WorkflowDTO | null = null;
      if (typeof ident === "number") {
        wf = workflows.find((w) => w.id === ident) || null;
      } else {
        wf = workflows.find((w) => w.trigger.toLowerCase() === ident.toLowerCase()) || null;
      }
      if (!wf) return { skill: "routine", reply: `No routine found with that name or ID.` };
      const ok = await deleteWorkflow(wf.id);
      if (ok) {
        return { skill: "routine", reply: `Routine "${wf.trigger}" deleted.`, refresh: ["workflows"] };
      }
      return { skill: "routine", reply: `Couldn't delete routine.` };
    }

    // list routines
    if (LIST_ROUTINE_RE.test(txt)) {
      const workflows = await listWorkflows();
      if (!workflows.length) return { skill: "routine", reply: `No routines configured.` };
      const lines = workflows.map((w) => `#${w.id}: "${w.trigger}"${w.enabled ? "" : " [disabled]"}${w.schedule ? ` [${w.schedule}]` : ""} → ${w.prompt.slice(0, 60)}${w.prompt.length > 60 ? "…" : ""}`);
      return { skill: "routine", reply: `Routines:\n${lines.join("\n")}` };
    }

    // Direct trigger match: user message exactly matches a routine trigger
    const workflows = await listWorkflows();
    const direct = workflows.find((w) => w.enabled && w.trigger.toLowerCase() === txt.trim().toLowerCase());
    if (direct) {
      const runCtx = buildContext(direct.prompt, {
        tz: ctx.tz,
        now: ctx.now,
        settings: ctx.settings,
        cloud: ctx.cloudAvailable ? { provider: ctx.provider!, model: ctx.model! } : null,
      });
      const result = await runSkills(runCtx, { skipKnowledge: false, only: undefined });
      await touchWorkflow(direct.id);
      if (result) {
        return { skill: "routine", reply: result.reply, refresh: result.refresh };
      }
      return { skill: "routine", reply: `⚙️ Routine "${direct.trigger}" ran.` };
    }

    return null;
  },
};

// ----------------------------- Scheduled workflow runner --------------------

export async function runDueWorkflows(ctx: { tz: string; now: Date; settings: any }): Promise<void> {
  const due = await dueWorkflows(ctx.now);
  for (const wf of due) {
    try {
      const runCtx = buildContext(wf.prompt, {
        tz: ctx.tz,
        now: ctx.now,
        settings: ctx.settings,
        cloud: null, // scheduler runs without cloud brain
      });
      const result = await runSkills(runCtx, { skipKnowledge: false, only: undefined });
      await touchWorkflow(wf.id);
      console.log(`[scheduler] ran workflow #${wf.id} "${wf.trigger}" — ${result ? result.reply.slice(0, 80) : "no handler"}`);
    } catch (err) {
      console.error(`[scheduler] workflow #${wf.id} failed:`, err);
    }
  }
}
