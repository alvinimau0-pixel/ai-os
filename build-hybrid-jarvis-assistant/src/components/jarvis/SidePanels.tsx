"use client";

import { Activity, Brain, Cloud, Cpu, Database, Ear, Mic, NotebookPen, Plus, Trash2, Volume2 } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useNow } from "@/hooks/useNow";
import { timeAgo } from "@/lib/format";
import type { BrainStatus, MemoryDTO, NoteDTO, SettingsDTO } from "@/lib/types";
import { EmptyState, Panel } from "./Panel";

// ------------------------------------------------------------------ Notes

export function NotesPanel({
  notes,
  onAdd,
  onDelete,
  className,
}: {
  notes: NoteDTO[];
  onAdd: (content: string) => void;
  onDelete: (id: number) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const now = useNow(60000);

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Panel
      title="Notes"
      icon={NotebookPen}
      className={className}
      bodyClassName="flex flex-col"
      right={<span className="text-[10px] text-mute">{notes.length}</span>}
    >
      <div className="flex shrink-0 gap-2 p-2">
        <textarea
          className="hud-input resize-none"
          rows={2}
          placeholder="Jot something down…"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          aria-label="New note"
        />
        <button type="button" className="hud-btn shrink-0 self-start" onClick={submit} aria-label="Save note">
          <Plus className="size-3.5" />
        </button>
      </div>
      <ul className="hud-scroll m-0 min-h-0 flex-1 list-none space-y-1 overflow-y-auto px-2 pb-2">
        {notes.length === 0 && (
          <li>
            <EmptyState icon={NotebookPen}>No notes yet. Try “take a note: …”.</EmptyState>
          </li>
        )}
        {notes.map((n) => (
          <li key={n.id} className="group rounded border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
            <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-snug text-ink/90">{n.content}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-mute">{now === null ? "" : timeAgo(n.createdAt, now)}</span>
              <button type="button" onClick={() => onDelete(n.id)} className="text-mute/60 opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label="Delete note">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ----------------------------------------------------------------- Memory

export function MemoryPanel({
  memories,
  settings,
  onAdd,
  onDelete,
  className,
}: {
  memories: MemoryDTO[];
  settings: SettingsDTO;
  onAdd: (content: string) => void;
  onDelete: (id: number) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText("");
  };
  const profile = [settings.userName && `Name: ${settings.userName}`, settings.location && `Location: ${settings.location}`].filter(Boolean) as string[];

  return (
    <Panel
      title="Memory"
      icon={Brain}
      className={className}
      bodyClassName="flex flex-col"
      right={<span className="text-[10px] text-mute">{memories.length} facts</span>}
    >
      <form onSubmit={submit} className="flex shrink-0 gap-2 p-2">
        <input className="hud-input" placeholder="Teach me something…" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} aria-label="New memory" />
        <button type="submit" className="hud-btn shrink-0" aria-label="Save memory">
          <Plus className="size-3.5" />
        </button>
      </form>
      <ul className="hud-scroll m-0 min-h-0 flex-1 list-none space-y-1 overflow-y-auto px-2 pb-2">
        {profile.map((p) => (
          <li key={p} className="rounded border border-ok/20 bg-ok/5 px-2.5 py-1.5 text-[12px] text-ok/90">
            {p}
          </li>
        ))}
        {memories.length === 0 && profile.length === 0 && (
          <li>
            <EmptyState icon={Brain}>I remember what you tell me. Try “remember that …”.</EmptyState>
          </li>
        )}
        {memories.map((m) => (
          <li key={m.id} className="group flex items-start gap-2 rounded border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5">
            <p className="m-0 min-w-0 flex-1 break-words text-[12.5px] leading-snug text-ink/90">{m.content}</p>
            <button type="button" onClick={() => onDelete(m.id)} className="mt-0.5 shrink-0 text-mute/60 opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label="Forget this">
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ----------------------------------------------------------------- System

function Row({ icon, label, children, tone = "ok" }: { icon: ReactNode; label: string; children: ReactNode; tone?: "ok" | "warn" | "mute" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-ember" : "text-mute";
  return (
    <li className="flex items-center gap-2 py-1 text-[12px]">
      <span className="text-mute">{icon}</span>
      <span className="text-mute">{label}</span>
      <span className={`ml-auto flex items-center gap-1.5 text-[10px] ${color}`}>
        <span className={`size-1.5 rounded-full bg-current ${tone === "ok" ? "shadow-[0_0_6px_currentColor]" : ""}`} />
        {children}
      </span>
    </li>
  );
}

export function SystemPanel({
  brain,
  settings,
  sttSupported,
  ttsSupported,
  handsFree,
  onOpenSettings,
  className,
}: {
  brain: BrainStatus;
  settings: SettingsDTO;
  sttSupported: boolean;
  ttsSupported: boolean;
  handsFree: boolean;
  onOpenSettings: () => void;
  className?: string;
}) {
  const mode = brain.cloudAvailable ? settings.brainMode : "local";
  return (
    <Panel
      title="Systems"
      icon={Activity}
      className={className}
      bodyClassName="px-3 py-1.5"
      right={
        <button type="button" onClick={onOpenSettings} className="text-[11px] text-mute hover:text-ink">
          Configure
        </button>
      }
    >
      <ul className="m-0 list-none divide-y divide-white/[0.06] p-0">
        <Row icon={<Cpu className="size-3.5" />} label="Local core">
          {brain.skillCount} skills
        </Row>
        <Row icon={<Cloud className="size-3.5" />} label="Cloud brain" tone={brain.cloudAvailable ? "ok" : "warn"}>
          {brain.cloudAvailable ? "linked" : "not linked"}
        </Row>
        <Row icon={<Brain className="size-3.5" />} label="Routing" tone="mute">
          {mode}
        </Row>
        <Row icon={<Database className="size-3.5" />} label="Database">
          online
        </Row>
        <Row icon={<Volume2 className="size-3.5" />} label="Voice output" tone={ttsSupported ? "ok" : "mute"}>
          {ttsSupported ? "ready" : "n/a"}
        </Row>
        <Row icon={<Mic className="size-3.5" />} label="Voice input" tone={sttSupported ? "ok" : "mute"}>
          {sttSupported ? "ready" : "n/a"}
        </Row>
        <Row icon={<Ear className="size-3.5" />} label="Hands-free" tone={handsFree ? "ok" : "mute"}>
          {handsFree ? "listening" : "off"}
        </Row>
      </ul>
      <p className="m-0 border-t border-white/[0.06] py-2 text-[11px] leading-relaxed text-mute">
        {brain.cloudAvailable
          ? `${brain.provider} · ${brain.model}`
          : "Running on the local core. Add an LLM API key to enable the cloud brain — see Config."}
      </p>
    </Panel>
  );
}
