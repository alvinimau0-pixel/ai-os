import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { OnboardingStepId } from "@/lib/onboarding/types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Single-row table (id = 1) holding assistant preferences. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  assistantName: text("assistant_name").notNull().default("JARVIS"),
  userName: text("user_name").notNull().default(""),
  brainMode: text("brain_mode").notNull().default("hybrid"),
  brainBackend: text("brain_backend").notNull().default("api"),
  voiceName: text("voice_name").notNull().default(""),
  voiceRate: doublePrecision("voice_rate").notNull().default(1),
  voicePitch: doublePrecision("voice_pitch").notNull().default(0.9),
  autoSpeak: boolean("auto_speak").notNull().default(true),
  wakeWord: text("wake_word").notNull().default("jarvis"),
  location: text("location").notNull().default(""),
  units: text("units").notNull().default("metric"),
  personality: text("personality").notNull().default("classic"),
  onboardingCompletedSteps: jsonb("onboarding_completed_steps").$type<OnboardingStepId[]>().notNull().default([]),
  onboardingDismissedAt: ts("onboarding_dismissed_at"),
  onboardingCompletedAt: ts("onboarding_completed_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("New session"),
  ocSessionId: text("oc_session_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull().default("local"),
    skill: text("skill"),
    meta: jsonb("meta"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  priority: text("priority").notNull().default("normal"),
  dueAt: ts("due_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    label: text("label").notNull(),
    kind: text("kind").notNull().default("reminder"),
    dueAt: ts("due_at").notNull(),
    durationSec: integer("duration_sec"),
    status: text("status").notNull().default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
    firedAt: ts("fired_at"),
  },
  (t) => [index("reminders_status_due_idx").on(t.status, t.dueAt)],
);

export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  trigger: text("trigger").notNull().unique(),
  prompt: text("prompt").notNull(),
  schedule: text("schedule"),
  enabled: boolean("enabled").notNull().default(true),
  lastRun: ts("last_run"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const mcpServers = pgTable("mcp_servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  transport: text("transport").notNull().default("stdio"),
  command: text("command"),
  args: jsonb("args").$type<string[]>().notNull().default([]),
  url: text("url"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});
