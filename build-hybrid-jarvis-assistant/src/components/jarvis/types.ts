import type { MessageDTO } from "@/lib/types";

export interface ToolChip {
  name: string;
  status: "running" | "done";
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "local" | "cloud" | "system";
  skill?: string | null;
  model?: string | null;
  tools?: ToolChip[];
  streaming?: boolean;
  error?: boolean;
}

export function toChat(m: MessageDTO): ChatMessage {
  return { id: `db-${m.id}`, role: m.role, content: m.content, source: m.source, skill: m.skill, model: m.model };
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "warn" | "alert" | "ok";
}
