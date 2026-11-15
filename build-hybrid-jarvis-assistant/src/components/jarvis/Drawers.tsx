"use client";

import { History, ListChecks, MessageSquarePlus, NotebookPen, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { useNow } from "@/hooks/useNow";
import { timeAgo } from "@/lib/format";
import type { BrainStatus, ConversationDTO, MemoryDTO, NoteDTO, ReminderDTO, SettingsDTO, TaskDTO } from "@/lib/types";
import { RemindersPanel, TasksPanel } from "./AgendaPanels";
import { MemoryPanel, NotesPanel, SystemPanel } from "./SidePanels";

export { SettingsDrawer } from "./settings/SettingsDrawer";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);
}

// ------------------------------------------------------------- Sessions

interface SessionsProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationDTO[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onNew: () => void;
}

export function SessionsDrawer({ open, onClose, conversations, activeId, onSelect, onDelete, onNew }: SessionsProps) {
  const now = useNow(60000);
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Sessions">
      <aside className="anim-slide-left hud-panel hud-scroll relative flex h-full w-[min(360px,92vw)] flex-col rounded-none border-y-0 border-l-0">
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <h2 className="hud-label m-0 flex items-center gap-2 text-[11px]">
            <History className="size-3.5" /> Sessions
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" className="hud-btn px-2 py-1" onClick={() => { onNew(); onClose(); }}>
              <MessageSquarePlus className="size-3.5" /> New
            </button>
            <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </header>
        <ul className="hud-scroll m-0 min-h-0 flex-1 list-none space-y-1 overflow-y-auto p-2">
          {conversations.length === 0 && <li className="px-3 py-8 text-center text-xs text-mute">No sessions yet. Say hello.</li>}
          {conversations.map((c) => (
            <li key={c.id} className="group">
              <div className={`flex items-center gap-2 rounded border px-3 py-2 transition ${c.id === activeId ? "border-arc/30 bg-arc/[0.08]" : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"}`}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { onSelect(c.id); onClose(); }}>
                  <span className="block truncate text-[13px] text-ink">{c.title}</span>
                  <span className="block text-[10px] text-mute">{now === null ? "" : timeAgo(c.updatedAt, now)}</span>
                </button>
                <button type="button" onClick={() => onDelete(c.id)} className="shrink-0 text-mute/60 opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${c.title}`}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
      <button type="button" className="absolute inset-0 -z-10 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-label="Close sessions" />
    </div>
  );
}

// ------------------------------------------------------------- Agenda

interface AgendaProps {
  open: boolean;
  onClose: () => void;
  tasks: TaskDTO[];
  reminders: ReminderDTO[];
  onAddTask: (title: string) => void;
  onToggleTask: (t: TaskDTO) => void;
  onPriorityTask: (t: TaskDTO) => void;
  onDeleteTask: (id: number) => void;
  onClearDoneTasks: () => void;
  onAddTimer: (seconds: number) => void;
  onAddReminder: (label: string, minutes: number) => void;
  onDismissReminder: (id: number) => void;
  onDeleteReminder: (id: number) => void;
}

export function AgendaDrawer({
  open,
  onClose,
  tasks,
  reminders,
  onAddTask,
  onToggleTask,
  onPriorityTask,
  onDeleteTask,
  onClearDoneTasks,
  onAddTimer,
  onAddReminder,
  onDismissReminder,
  onDeleteReminder,
}: AgendaProps) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Agenda">
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-label="Close agenda" />
      <aside className="anim-slide-right relative flex h-full w-[min(420px,100vw)] flex-col gap-3 border-l border-white/[0.07] bg-[#0b0c0f] p-3">
        <header className="flex shrink-0 items-center justify-between px-1">
          <h2 className="m-0 flex items-center gap-2 text-[12px] font-medium text-ink">
            <ListChecks className="size-3.5 text-mute" /> Agenda
          </h2>
          <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <TasksPanel
          className="min-h-0 flex-[1.15]"
          tasks={tasks}
          onAdd={onAddTask}
          onToggle={onToggleTask}
          onPriority={onPriorityTask}
          onDelete={onDeleteTask}
          onClearDone={onClearDoneTasks}
        />
        <RemindersPanel
          className="min-h-0 flex-1"
          reminders={reminders}
          onAddTimer={onAddTimer}
          onAddReminder={onAddReminder}
          onDismiss={onDismissReminder}
          onDelete={onDeleteReminder}
        />
      </aside>
    </div>
  );
}

// -------------------------------------------------------------- Intel

interface IntelProps {
  open: boolean;
  onClose: () => void;
  notes: NoteDTO[];
  memories: MemoryDTO[];
  brain: BrainStatus;
  settings: SettingsDTO;
  sttSupported: boolean;
  ttsSupported: boolean;
  handsFree: boolean;
  onAddNote: (content: string) => void;
  onDeleteNote: (id: number) => void;
  onAddMemory: (content: string) => void;
  onDeleteMemory: (id: number) => void;
  onOpenSettings: () => void;
}

export function IntelDrawer({
  open,
  onClose,
  notes,
  memories,
  brain,
  settings,
  sttSupported,
  ttsSupported,
  handsFree,
  onAddNote,
  onDeleteNote,
  onAddMemory,
  onDeleteMemory,
  onOpenSettings,
}: IntelProps) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Intel">
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-label="Close intel" />
      <aside className="anim-slide-right relative flex h-full w-[min(420px,100vw)] flex-col gap-3 border-l border-white/[0.07] bg-[#0b0c0f] p-3">
        <header className="flex shrink-0 items-center justify-between px-1">
          <h2 className="m-0 flex items-center gap-2 text-[12px] font-medium text-ink">
            <NotebookPen className="size-3.5 text-mute" /> Intel
          </h2>
          <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <NotesPanel className="min-h-0 flex-[1.1]" notes={notes} onAdd={onAddNote} onDelete={onDeleteNote} />
        <MemoryPanel className="min-h-0 flex-1" memories={memories} settings={settings} onAdd={onAddMemory} onDelete={onDeleteMemory} />
        <SystemPanel
          className="shrink-0"
          brain={brain}
          settings={settings}
          sttSupported={sttSupported}
          ttsSupported={ttsSupported}
          handsFree={handsFree}
          onOpenSettings={onOpenSettings}
        />
      </aside>
    </div>
  );
}
