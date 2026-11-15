// Shared, JSON-safe types used by both the server and the client.

export type BrainMode = "hybrid" | "local" | "cloud";
/** Which engine plays the "brain": the OpenAI-compatible API endpoint, or an OpenCode agent server. */
export type BrainBackend = "api" | "opencode";
export type Personality = "classic" | "concise" | "friendly";
export type Units = "metric" | "imperial";
export type Priority = "low" | "normal" | "high";
export type ReminderKind = "reminder" | "timer";
export type ReminderStatus = "pending" | "fired" | "dismissed";
export type ResourceKey =
  | "tasks"
  | "notes"
  | "reminders"
  | "memories"
  | "settings"
  | "conversations"
  | "workflows";

export interface SettingsDTO {
  assistantName: string;
  userName: string;
  brainMode: BrainMode;
  brainBackend: BrainBackend;
  voiceName: string;
  voiceRate: number;
  voicePitch: number;
  autoSpeak: boolean;
  wakeWord: string;
  location: string;
  units: Units;
  personality: Personality;
}

export interface TaskDTO {
  id: number;
  title: string;
  done: boolean;
  priority: Priority;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface NoteDTO {
  id: number;
  content: string;
  createdAt: string;
}

export interface ReminderDTO {
  id: number;
  label: string;
  kind: ReminderKind;
  dueAt: string;
  durationSec: number | null;
  status: ReminderStatus;
  createdAt: string;
  firedAt: string | null;
}

export interface MemoryDTO {
  id: number;
  content: string;
  createdAt: string;
}

export interface MessageDTO {
  id: number;
  role: "user" | "assistant";
  content: string;
  source: "local" | "cloud" | "system";
  skill: string | null;
  model: string | null;
  createdAt: string;
}

export interface ConversationDTO {
  id: number;
  title: string;
  updatedAt: string;
  createdAt: string;
}

export interface BrainStatus {
  cloudAvailable: boolean;
  provider: string | null;
  model: string | null;
  skillCount: number;
}

export interface BootstrapData {
  settings: SettingsDTO;
  tasks: TaskDTO[];
  notes: NoteDTO[];
  reminders: ReminderDTO[];
  memories: MemoryDTO[];
  conversations: ConversationDTO[];
  activeConversationId: number | null;
  messages: MessageDTO[];
  brain: BrainStatus;
}

export type ClientCommand =
  | { type: "new_session" }
  | { type: "stop_speaking" }
  | { type: "set_autospeak"; value: boolean };

export type StreamEvent =
  | { type: "start"; route: "local" | "cloud"; model?: string; conversationId: number }
  | { type: "skill"; name: string }
  | { type: "tool"; name: string; status: "running" | "done"; summary?: string }
  | { type: "delta"; text: string }
  | { type: "refresh"; resources: ResourceKey[] }
  | { type: "client"; command: ClientCommand }
  | {
      type: "done";
      messageId: number;
      route: "local" | "cloud";
      skill: string | null;
      model?: string;
      conversationId: number;
      title: string;
    }
  | { type: "error"; message: string };
