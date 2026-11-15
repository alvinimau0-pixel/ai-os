import { db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import {
  normalizeOnboardingState,
  type OnboardingStepId,
} from "@/lib/onboarding/types";
import type {
  BootstrapData,
  BrainMode,
  BrainStatus,
  ConversationDTO,
  MemoryDTO,
  MessageDTO,
  NoteDTO,
  Personality,
  Priority,
  ReminderDTO,
  ReminderKind,
  ReminderStatus,
  SettingsDTO,
  TaskDTO,
  Units,
} from "@/lib/types";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// ---------------------------------------------------------------------------
// Fuzzy matching helper (used for "complete task X", "forget Y", ...)
// ---------------------------------------------------------------------------

const STOP = new Set([
  "the", "a", "an", "my", "to", "for", "of", "and", "task", "tasks", "todo", "note", "notes", "reminder",
  "reminders", "timer", "timers", "please", "about", "that", "on", "in", "it", "this", "is", "as", "done",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

export function bestMatch<T>(items: T[], query: string, text: (t: T) => string): T | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  const exact = items.find((i) => text(i).toLowerCase().includes(q));
  if (exact) return exact;
  const qw = words(q);
  if (!qw.length) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const tw = words(text(item));
    const hits = qw.filter((w) => tw.some((x) => x === w || (w.length > 3 && x.startsWith(w)) || (x.length > 3 && w.startsWith(x)))).length;
    const score = hits / qw.length;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type SettingsRow = typeof s.settings.$inferSelect;

function toSettings(r: SettingsRow): SettingsDTO {
  const modes: BrainMode[] = ["hybrid", "local", "cloud"];
  const personalities: Personality[] = ["classic", "concise", "friendly"];
  return {
    assistantName: r.assistantName,
    userName: r.userName,
    brainMode: modes.includes(r.brainMode as BrainMode) ? (r.brainMode as BrainMode) : "hybrid",
    brainBackend: r.brainBackend === "opencode" ? "opencode" : "api",
    voiceName: r.voiceName,
    voiceRate: r.voiceRate,
    voicePitch: r.voicePitch,
    autoSpeak: r.autoSpeak,
    wakeWord: r.wakeWord,
    location: r.location,
    units: r.units === "imperial" ? "imperial" : "metric",
    personality: personalities.includes(r.personality as Personality) ? (r.personality as Personality) : "classic",
    onboarding: normalizeOnboardingState({
      completedSteps: r.onboardingCompletedSteps,
      dismissedAt: iso(r.onboardingDismissedAt),
      completedAt: iso(r.onboardingCompletedAt),
    }),
  };
}

export async function getSettings(): Promise<SettingsDTO> {
  let [row] = await db.select().from(s.settings).where(eq(s.settings.id, 1));
  if (!row) {
    await db.insert(s.settings).values({ id: 1 }).onConflictDoNothing();
    [row] = await db.select().from(s.settings).where(eq(s.settings.id, 1));
  }
  return toSettings(row);
}

export function sanitizeSettings(input: Record<string, unknown>): Partial<SettingsDTO> {
  const out: Partial<SettingsDTO> = {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
  const num = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;

  const assistantName = str(input.assistantName, 24);
  if (assistantName) out.assistantName = assistantName;
  const userName = str(input.userName, 40);
  if (userName !== undefined) out.userName = userName;
  if (input.brainMode === "hybrid" || input.brainMode === "local" || input.brainMode === "cloud") out.brainMode = input.brainMode;
  if (input.brainBackend === "api" || input.brainBackend === "opencode") out.brainBackend = input.brainBackend;
  const voiceName = str(input.voiceName, 200);
  if (voiceName !== undefined) out.voiceName = voiceName;
  const rate = num(input.voiceRate, 0.5, 2);
  if (rate !== undefined) out.voiceRate = rate;
  const pitch = num(input.voicePitch, 0, 2);
  if (pitch !== undefined) out.voicePitch = pitch;
  if (typeof input.autoSpeak === "boolean") out.autoSpeak = input.autoSpeak;
  const wake = str(input.wakeWord, 24)?.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  if (wake && wake.length >= 2) out.wakeWord = wake;
  const location = str(input.location, 80);
  if (location !== undefined) out.location = location;
  if (input.units === "metric" || input.units === "imperial") out.units = input.units as Units;
  if (input.personality === "classic" || input.personality === "concise" || input.personality === "friendly") {
    out.personality = input.personality;
  }
  if (input.onboarding !== undefined) out.onboarding = normalizeOnboardingState(input.onboarding);
  return out;
}

export async function updateSettings(patch: Partial<SettingsDTO>): Promise<SettingsDTO> {
  await getSettings();
  const clean = sanitizeSettings(patch as Record<string, unknown>);
  const { onboarding, ...rest } = clean;
  if (Object.keys(rest).length > 0 || onboarding !== undefined) {
    const set: Partial<typeof s.settings.$inferInsert> = { ...rest, updatedAt: new Date() };
    if (onboarding !== undefined) {
      set.onboardingCompletedSteps = [...onboarding.completedSteps];
      set.onboardingDismissedAt = onboarding.dismissedAt ? new Date(onboarding.dismissedAt) : null;
      set.onboardingCompletedAt = onboarding.completedAt ? new Date(onboarding.completedAt) : null;
    }
    await db.update(s.settings).set(set).where(eq(s.settings.id, 1));
  }
  return getSettings();
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

type TaskRow = typeof s.tasks.$inferSelect;

function toTask(r: TaskRow): TaskDTO {
  return {
    id: r.id,
    title: r.title,
    done: r.done,
    priority: (["low", "normal", "high"].includes(r.priority) ? r.priority : "normal") as Priority,
    dueAt: iso(r.dueAt),
    createdAt: r.createdAt.toISOString(),
    completedAt: iso(r.completedAt),
  };
}

export async function listTasks(): Promise<TaskDTO[]> {
  const rows = await db.select().from(s.tasks).orderBy(asc(s.tasks.id));
  const rank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  return rows.map(toTask).sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done && b.done) return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.id - b.id;
  });
}

export async function openTasks(): Promise<TaskDTO[]> {
  return (await listTasks()).filter((t) => !t.done);
}

export async function addTask(input: { title: string; priority?: Priority; dueAt?: Date | null }): Promise<TaskDTO> {
  const [row] = await db
    .insert(s.tasks)
    .values({ title: input.title.trim().slice(0, 300), priority: input.priority ?? "normal", dueAt: input.dueAt ?? null })
    .returning();
  return toTask(row);
}

export async function updateTask(
  id: number,
  patch: { title?: string; done?: boolean; priority?: Priority; dueAt?: Date | null },
): Promise<TaskDTO | null> {
  const set: Partial<typeof s.tasks.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 300);
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.done !== undefined) {
    set.done = patch.done;
    set.completedAt = patch.done ? new Date() : null;
  }
  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(s.tasks).where(eq(s.tasks.id, id));
    return row ? toTask(row) : null;
  }
  const [row] = await db.update(s.tasks).set(set).where(eq(s.tasks.id, id)).returning();
  return row ? toTask(row) : null;
}

export async function deleteTask(id: number): Promise<boolean> {
  const rows = await db.delete(s.tasks).where(eq(s.tasks.id, id)).returning({ id: s.tasks.id });
  return rows.length > 0;
}

export async function clearCompletedTasks(): Promise<number> {
  const rows = await db.delete(s.tasks).where(eq(s.tasks.done, true)).returning({ id: s.tasks.id });
  return rows.length;
}

export async function deleteAllTasks(): Promise<number> {
  const rows = await db.delete(s.tasks).returning({ id: s.tasks.id });
  return rows.length;
}

/** Resolve "2", "#2" (position among open tasks) or free text to an open task. */
export async function findOpenTask(query: string): Promise<TaskDTO | null> {
  const open = await openTasks();
  const num = query.trim().match(/^(?:#|number\s+|no\.?\s*)?(\d+)$/i);
  if (num) {
    const idx = Number(num[1]) - 1;
    return open[idx] ?? null;
  }
  return bestMatch(open, query, (t) => t.title);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function toNote(r: typeof s.notes.$inferSelect): NoteDTO {
  return { id: r.id, content: r.content, createdAt: r.createdAt.toISOString() };
}

export async function listNotes(): Promise<NoteDTO[]> {
  const rows = await db.select().from(s.notes).orderBy(desc(s.notes.createdAt), desc(s.notes.id));
  return rows.map(toNote);
}

export async function addNote(content: string): Promise<NoteDTO> {
  const [row] = await db.insert(s.notes).values({ content: content.trim().slice(0, 4000) }).returning();
  return toNote(row);
}

export async function deleteNote(id: number): Promise<boolean> {
  const rows = await db.delete(s.notes).where(eq(s.notes.id, id)).returning({ id: s.notes.id });
  return rows.length > 0;
}

export async function deleteAllNotes(): Promise<number> {
  const rows = await db.delete(s.notes).returning({ id: s.notes.id });
  return rows.length;
}

export async function searchNotes(query: string): Promise<NoteDTO[]> {
  const all = await listNotes();
  const q = query.toLowerCase().trim();
  const qw = words(q);
  return all.filter((n) => {
    const c = n.content.toLowerCase();
    return c.includes(q) || (qw.length > 0 && qw.every((w) => c.includes(w)));
  });
}

// ---------------------------------------------------------------------------
// Reminders & timers
// ---------------------------------------------------------------------------

function toReminder(r: typeof s.reminders.$inferSelect): ReminderDTO {
  return {
    id: r.id,
    label: r.label,
    kind: (r.kind === "timer" ? "timer" : "reminder") as ReminderKind,
    dueAt: r.dueAt.toISOString(),
    durationSec: r.durationSec,
    status: (["pending", "fired", "dismissed"].includes(r.status) ? r.status : "pending") as ReminderStatus,
    createdAt: r.createdAt.toISOString(),
    firedAt: iso(r.firedAt),
  };
}

export async function pendingReminders(): Promise<ReminderDTO[]> {
  const rows = await db.select().from(s.reminders).where(eq(s.reminders.status, "pending")).orderBy(asc(s.reminders.dueAt));
  return rows.map(toReminder);
}

export async function listReminders(): Promise<ReminderDTO[]> {
  const pending = await pendingReminders();
  const recent = await db
    .select()
    .from(s.reminders)
    .where(eq(s.reminders.status, "fired"))
    .orderBy(desc(s.reminders.firedAt))
    .limit(5);
  return [...pending, ...recent.map(toReminder)];
}

export async function addReminder(input: {
  label: string;
  kind?: ReminderKind;
  dueAt: Date;
  durationSec?: number | null;
}): Promise<ReminderDTO> {
  const [row] = await db
    .insert(s.reminders)
    .values({
      label: input.label.trim().slice(0, 300) || (input.kind === "timer" ? "Timer" : "Reminder"),
      kind: input.kind ?? "reminder",
      dueAt: input.dueAt,
      durationSec: input.durationSec ?? null,
    })
    .returning();
  return toReminder(row);
}

/** Atomically move a reminder to a new status. For "fired", only succeeds if it was pending. */
export async function setReminderStatus(
  id: number,
  status: "fired" | "dismissed",
): Promise<{ changed: boolean; reminder: ReminderDTO | null }> {
  const where =
    status === "fired"
      ? and(eq(s.reminders.id, id), eq(s.reminders.status, "pending"))
      : and(eq(s.reminders.id, id), ne(s.reminders.status, "dismissed"));
  const rows = await db
    .update(s.reminders)
    .set({ status, firedAt: status === "fired" ? new Date() : undefined })
    .where(where)
    .returning();
  return { changed: rows.length > 0, reminder: rows[0] ? toReminder(rows[0]) : null };
}

export async function deleteReminder(id: number): Promise<boolean> {
  const rows = await db.delete(s.reminders).where(eq(s.reminders.id, id)).returning({ id: s.reminders.id });
  return rows.length > 0;
}

export async function cancelPendingByKind(kind: ReminderKind): Promise<number> {
  const rows = await db
    .delete(s.reminders)
    .where(and(eq(s.reminders.kind, kind), eq(s.reminders.status, "pending")))
    .returning({ id: s.reminders.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

function toMemory(r: typeof s.memories.$inferSelect): MemoryDTO {
  return { id: r.id, content: r.content, createdAt: r.createdAt.toISOString() };
}

export async function listMemories(): Promise<MemoryDTO[]> {
  const rows = await db.select().from(s.memories).orderBy(desc(s.memories.createdAt), desc(s.memories.id));
  return rows.map(toMemory);
}

export async function addMemory(content: string): Promise<{ memory: MemoryDTO; created: boolean }> {
  const text = content.trim().slice(0, 500);
  const all = await listMemories();
  const dup = all.find((m) => m.content.toLowerCase() === text.toLowerCase());
  if (dup) return { memory: dup, created: false };
  const [row] = await db.insert(s.memories).values({ content: text }).returning();
  return { memory: toMemory(row), created: true };
}

export async function deleteMemory(id: number): Promise<boolean> {
  const rows = await db.delete(s.memories).where(eq(s.memories.id, id)).returning({ id: s.memories.id });
  return rows.length > 0;
}

export async function deleteAllMemories(): Promise<number> {
  const rows = await db.delete(s.memories).returning({ id: s.memories.id });
  return rows.length;
}

export async function forgetMemory(query: string): Promise<MemoryDTO | null> {
  const all = await listMemories();
  const hit = bestMatch(all, query, (m) => m.content);
  if (!hit) return null;
  await deleteMemory(hit.id);
  return hit;
}

// ---------------------------------------------------------------------------
// Conversations & messages
// ---------------------------------------------------------------------------

function toConversation(r: typeof s.conversations.$inferSelect): ConversationDTO {
  return { id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString(), createdAt: r.createdAt.toISOString() };
}

export async function createConversation(title = "New session"): Promise<ConversationDTO> {
  const [row] = await db.insert(s.conversations).values({ title: title.slice(0, 80) }).returning();
  return toConversation(row);
}

export async function listConversations(limit = 40): Promise<ConversationDTO[]> {
  const rows = await db.select().from(s.conversations).orderBy(desc(s.conversations.updatedAt), desc(s.conversations.id)).limit(limit);
  return rows.map(toConversation);
}

export async function getConversation(id: number): Promise<ConversationDTO | null> {
  const [row] = await db.select().from(s.conversations).where(eq(s.conversations.id, id));
  return row ? toConversation(row) : null;
}

export async function renameConversation(id: number, title: string): Promise<void> {
  await db.update(s.conversations).set({ title: title.slice(0, 80) }).where(eq(s.conversations.id, id));
}

/** OpenCode brain session mapped to this conversation (null = none created yet). */
export async function getOpenCodeSessionId(conversationId: number): Promise<string | null> {
  const [row] = await db.select({ oc: s.conversations.ocSessionId }).from(s.conversations).where(eq(s.conversations.id, conversationId));
  return row?.oc ?? null;
}

export async function setOpenCodeSessionId(conversationId: number, ocSessionId: string | null): Promise<void> {
  await db.update(s.conversations).set({ ocSessionId }).where(eq(s.conversations.id, conversationId));
}

export async function deleteConversation(id: number): Promise<boolean> {
  const rows = await db.delete(s.conversations).where(eq(s.conversations.id, id)).returning({ id: s.conversations.id });
  return rows.length > 0;
}

export async function deleteAllConversations(): Promise<number> {
  const rows = await db.delete(s.conversations).returning({ id: s.conversations.id });
  return rows.length;
}

function toMessage(r: typeof s.messages.$inferSelect): MessageDTO {
  const meta = (r.meta ?? {}) as { model?: string };
  return {
    id: r.id,
    role: r.role === "user" ? "user" : "assistant",
    content: r.content,
    source: r.source === "cloud" ? "cloud" : r.source === "system" ? "system" : "local",
    skill: r.skill,
    model: meta.model ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getMessages(conversationId: number, limit = 200): Promise<MessageDTO[]> {
  const rows = await db
    .select()
    .from(s.messages)
    .where(eq(s.messages.conversationId, conversationId))
    .orderBy(desc(s.messages.id))
    .limit(limit);
  return rows.reverse().map(toMessage);
}

export async function getRecentTurns(conversationId: number, limit = 20): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const msgs = await getMessages(conversationId, limit);
  return msgs.map((m) => ({ role: m.role, content: m.content }));
}

export async function addMessage(input: {
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  source?: "local" | "cloud" | "system";
  skill?: string | null;
  model?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(s.messages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      source: input.source ?? "local",
      skill: input.skill ?? null,
      meta: input.model ? { model: input.model } : null,
    })
    .returning({ id: s.messages.id });
  await db.update(s.conversations).set({ updatedAt: new Date() }).where(eq(s.conversations.id, input.conversationId));
  return row.id;
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export async function getStats(): Promise<{
  openTasks: number;
  notes: number;
  pendingReminders: number;
  memories: number;
  conversations: number;
}> {
  const [t, n, r, m, c] = await Promise.all([
    db.select({ n: count() }).from(s.tasks).where(eq(s.tasks.done, false)),
    db.select({ n: count() }).from(s.notes),
    db.select({ n: count() }).from(s.reminders).where(eq(s.reminders.status, "pending")),
    db.select({ n: count() }).from(s.memories),
    db.select({ n: count() }).from(s.conversations),
  ]);
  return {
    openTasks: t[0].n,
    notes: n[0].n,
    pendingReminders: r[0].n,
    memories: m[0].n,
    conversations: c[0].n,
  };
}

export async function loadBootstrap(brain: BrainStatus): Promise<BootstrapData> {
  const [settings, tasks, notes, reminders, memories, conversations] = await Promise.all([
    getSettings(),
    listTasks(),
    listNotes(),
    listReminders(),
    listMemories(),
    listConversations(),
  ]);
  const active = conversations[0] ?? null;
  const messages = active ? await getMessages(active.id) : [];
  return {
    settings,
    tasks,
    notes,
    reminders,
    memories,
    conversations,
    activeConversationId: active?.id ?? null,
    messages,
    brain,
  };
}

// ---------------------------------------------------------------------------
// Workflows (routines)
// ---------------------------------------------------------------------------

export interface WorkflowDTO {
  id: number;
  trigger: string;
  prompt: string;
  schedule: string | null;
  enabled: boolean;
  lastRun: string | null;
  createdAt: string;
}

function toWorkflow(r: typeof s.workflows.$inferSelect): WorkflowDTO {
  return {
    id: r.id,
    trigger: r.trigger,
    prompt: r.prompt,
    schedule: r.schedule,
    enabled: r.enabled,
    lastRun: r.lastRun?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listWorkflows(): Promise<WorkflowDTO[]> {
  const rows = await db.select().from(s.workflows).orderBy(asc(s.workflows.id));
  return rows.map(toWorkflow);
}

export async function addWorkflow(input: { trigger: string; prompt: string; schedule?: string | null }): Promise<WorkflowDTO> {
  const trigger = input.trigger.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  const prompt = input.prompt.trim().slice(0, 2000);
  if (!trigger || !prompt) throw new Error("A routine needs both a trigger phrase and an action.");
  const schedule = input.schedule?.trim() ? input.schedule.trim().slice(0, 60) : null;
  const [row] = await db
    .insert(s.workflows)
    .values({ trigger, prompt, schedule })
    .onConflictDoNothing({ target: s.workflows.trigger })
    .returning();
  if (!row) throw new Error(`A routine with the trigger "${trigger}" already exists.`);
  return toWorkflow(row);
}

export async function deleteWorkflow(id: number): Promise<boolean> {
  const rows = await db.delete(s.workflows).where(eq(s.workflows.id, id)).returning({ id: s.workflows.id });
  return rows.length > 0;
}

export async function setWorkflowEnabled(id: number, enabled: boolean): Promise<boolean> {
  const rows = await db.update(s.workflows).set({ enabled }).where(eq(s.workflows.id, id)).returning({ id: s.workflows.id });
  return rows.length > 0;
}

export async function touchWorkflow(id: number): Promise<void> {
  await db.update(s.workflows).set({ lastRun: new Date() }).where(eq(s.workflows.id, id));
}

export async function dueWorkflows(now: Date): Promise<WorkflowDTO[]> {
  const rows = await db.select().from(s.workflows).where(eq(s.workflows.enabled, true));
  return rows.filter((r) => r.schedule && cronMatches(r.schedule, now)).map(toWorkflow);
}

/** Minimal 5-field cron matcher (min hour day month weekday; * , - / supported). */
function cronMatches(expr: string, at: Date): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const vals = [at.getMinutes(), at.getHours(), at.getDate(), at.getMonth() + 1, at.getDay()];
  return f.every((field, i) => {
    if (field === "*") return true;
    const range = i === 4 ? [0, 6] : i === 3 ? [1, 12] : i === 2 ? [1, 31] : i === 1 ? [0, 23] : [0, 59];
    return field.split(",").some((part) => {
      const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
      if (!m) return false;
      const lo = m[1] === "*" ? range[0] : Number(m[1]);
      const hi = m[2] ? Number(m[2]) : m[1] === "*" ? range[1] : lo;
      const step = m[3] ? Number(m[3]) : 1;
      for (let v = lo; v <= hi; v += step) if (v === vals[i]) return true;
      return false;
    });
  });
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

export interface McpServerDTO {
  id: number;
  name: string;
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
}

function toMcpServer(r: typeof s.mcpServers.$inferSelect): McpServerDTO {
  return {
    id: r.id,
    name: r.name,
    transport: r.transport,
    command: r.command,
    args: r.args,
    url: r.url,
    enabled: r.enabled,
  };
}

export async function listMcpServers(): Promise<McpServerDTO[]> {
  const rows = await db.select().from(s.mcpServers).orderBy(asc(s.mcpServers.id));
  return rows.map(toMcpServer);
}

export async function addMcpServer(input: { name: string; transport: string; command?: string; args?: string[]; url?: string }): Promise<McpServerDTO> {
  const name = input.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  if (!name) throw new Error("Server name must contain letters, digits, _ or -.");
  const transport = input.transport === "http" ? "http" : "stdio";
  if (transport === "stdio" && !input.command?.trim()) throw new Error("stdio servers need a command.");
  if (transport === "http" && !input.url?.trim()) throw new Error("http servers need a URL.");
  const [row] = await db
    .insert(s.mcpServers)
    .values({
      name,
      transport,
      command: transport === "stdio" ? input.command!.trim() : null,
      args: transport === "stdio" ? (input.args ?? []) : [],
      url: transport === "http" ? input.url!.trim() : null,
    })
    .onConflictDoNothing({ target: s.mcpServers.name })
    .returning();
  if (!row) throw new Error(`An MCP server named "${name}" already exists.`);
  return toMcpServer(row);
}

export async function deleteMcpServer(id: number): Promise<boolean> {
  const rows = await db.delete(s.mcpServers).where(eq(s.mcpServers.id, id)).returning({ id: s.mcpServers.id });
  return rows.length > 0;
}

export async function setMcpServerEnabled(id: number, enabled: boolean): Promise<boolean> {
  const rows = await db.update(s.mcpServers).set({ enabled }).where(eq(s.mcpServers.id, id)).returning({ id: s.mcpServers.id });
  return rows.length > 0;
}
