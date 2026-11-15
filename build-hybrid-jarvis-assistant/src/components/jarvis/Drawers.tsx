"use client";

import { Cloud, Cpu, History, ListChecks, MessageSquarePlus, NotebookPen, Play, Trash2, UserRound, Volume2, X, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNow } from "@/hooks/useNow";
import { timeAgo } from "@/lib/format";
import type { BrainBackend, BrainMode, BrainStatus, ConversationDTO, MemoryDTO, NoteDTO, Personality, ReminderDTO, SettingsDTO, TaskDTO, Units } from "@/lib/types";
import { RemindersPanel, TasksPanel } from "./AgendaPanels";
import { MemoryPanel, NotesPanel, SystemPanel } from "./SidePanels";

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

// ------------------------------------------------------------- Form bits

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-white/[0.06] px-4 py-4">
      <h3 className="hud-label m-0 mb-3 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink/90">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-mute">{hint}</span>}
    </label>
  );
}

function TextField({ value, onCommit, placeholder, maxLength = 60 }: { value: string; onCommit: (v: string) => void; placeholder?: string; maxLength?: number }) {
  const [v, setV] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setV(value);
  }
  const commit = () => {
    if (v.trim() !== value) onCommit(v.trim());
  };
  return (
    <input
      className="hud-input"
      value={v}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-active={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className="hud-btn px-2 py-2"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[12px] font-medium text-ink/90">{label}</div>
        {hint && <div className="text-[11px] leading-snug text-mute">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition ${checked ? "border-arc/70 bg-arc/25" : "border-white/15 bg-white/[0.06]"}`}
      >
        <span className={`absolute top-0.5 size-4.5 rounded-full bg-arc transition-all ${checked ? "left-[22px]" : "left-0.5 opacity-60"}`} />
      </button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onCommit,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  format: (v: number) => string;
}) {
  const [v, setV] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setV(value);
  }
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-[12px] font-medium text-ink/90">
        {label}
        <span className="font-hud text-[11px] text-arc">{format(v)}</span>
      </span>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => onCommit(v)}
        onKeyUp={() => onCommit(v)}
        onBlur={() => v !== value && onCommit(v)}
      />
    </label>
  );
}

// ------------------------------------------------------------- Settings

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  settings: SettingsDTO;
  brain: BrainStatus;
  voices: SpeechSynthesisVoice[];
  ttsSupported: boolean;
  onChange: (patch: Partial<SettingsDTO>) => void;
  onTestVoice: () => void;
  onClearHistory: () => void;
  onClearMemory: () => void;
}

const PROVIDER_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"];

export function SettingsDrawer({ open, onClose, settings, brain, voices, ttsSupported, onChange, onTestVoice, onClearHistory, onClearMemory }: SettingsProps) {
  useEscape(open, onClose);
  if (!open) return null;

  const sortedVoices = [...voices].sort((a, b) => {
    const ea = a.lang.toLowerCase().startsWith("en") ? 0 : 1;
    const eb = b.lang.toLowerCase().startsWith("en") ? 0 : 1;
    return ea - eb || a.name.localeCompare(b.name);
  });
  const needsCloud = !brain.cloudAvailable;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Settings">
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-label="Close settings" />
      <aside className="anim-slide-right hud-panel hud-scroll relative flex h-full w-[min(430px,100vw)] flex-col overflow-y-auto rounded-none border-y-0 border-r-0">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.07] bg-[#0b0c0f] px-4 py-3">
          <h2 className="hud-label m-0 text-[11px]">Configuration</h2>
          <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>

        <Section title="Brain routing" icon={<Cpu className="size-3.5" />}>
          <Segmented<BrainMode>
            value={settings.brainMode}
            onChange={(v) => onChange({ brainMode: v })}
            options={[
              { value: "local", label: "Local" },
              { value: "hybrid", label: "Hybrid", title: needsCloud ? "Needs a cloud API key — falls back to local" : undefined },
              { value: "cloud", label: "Cloud", title: needsCloud ? "Needs a cloud API key — falls back to local" : undefined },
            ]}
          />
          <p className="m-0 text-[11px] leading-relaxed text-mute">
            <strong className="text-ink/80">Hybrid</strong> answers commands (tasks, timers, math, weather…) instantly on the local core and sends everything else to the cloud brain.{" "}
            <strong className="text-ink/80">Local</strong> never leaves the server. <strong className="text-ink/80">Cloud</strong> routes everything through the LLM, which can still use all tools.
          </p>
          <Field
            label="Brain backend"
            hint={
              settings.brainBackend === "opencode"
                ? "The full OpenCode agent answers open-ended requests: it can run commands and edit files. The fast engine still handles simple work first."
                : "An OpenAI-compatible endpoint answers directly (API key, or a keyless local server such as Ollama)."
            }
          >
            <Segmented<BrainBackend>
              value={settings.brainBackend}
              onChange={(v) => onChange({ brainBackend: v })}
              options={[
                { value: "api", label: "API" },
                { value: "opencode", label: "OpenCode agent" },
              ]}
            />
          </Field>
          <div className={`rounded border px-3 py-2.5 text-[12px] ${brain.cloudAvailable ? "border-ok/30 bg-ok/5 text-ok" : "border-ember/30 bg-ember/5 text-ember"}`}>
            <div className="flex items-center gap-2 text-[11px] font-medium">
              <Cloud className="size-3.5" />
              {brain.cloudAvailable ? "Cloud brain linked" : "Cloud brain not linked"}
            </div>
            <p className="m-0 mt-1 leading-relaxed text-ink/80">
              {brain.cloudAvailable ? (
                <>
                  {brain.provider} · <span className="font-mono text-[11px]">{brain.model}</span>
                </>
              ) : (
                <>
                  Set one of these environment variables on the server, then restart:
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {PROVIDER_VARS.map((v) => (
                      <code key={v} className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-arc/90">
                        {v}
                      </code>
                    ))}
                  </span>
                  <span className="mt-1.5 block text-[11px] text-mute">
                    Optional: <code className="font-mono text-arc/90">LLM_MODEL</code>, or <code className="font-mono text-arc/90">LLM_BASE_URL</code> (+ <code className="font-mono text-arc/90">LLM_API_KEY</code>) for any OpenAI-compatible endpoint such as Ollama.
                  </span>
                </>
              )}
            </p>
          </div>
        </Section>

        <Section title="Identity" icon={<UserRound className="size-3.5" />}>
          <Field label="Assistant name">
            <TextField value={settings.assistantName} onCommit={(v) => v && onChange({ assistantName: v })} maxLength={24} />
          </Field>
          <Field label="Address me as" hint="Leave empty to be called “sir”.">
            <TextField value={settings.userName} onCommit={(v) => onChange({ userName: v })} placeholder="sir" maxLength={40} />
          </Field>
          <Field label="Home city" hint="Used as the default for weather and briefings.">
            <TextField value={settings.location} onCommit={(v) => onChange({ location: v })} placeholder="e.g. London" maxLength={80} />
          </Field>
          <Field label="Units">
            <Segmented<Units>
              value={settings.units}
              onChange={(v) => onChange({ units: v })}
              options={[
                { value: "metric", label: "Metric °C" },
                { value: "imperial", label: "Imperial °F" },
              ]}
            />
          </Field>
          <Field label="Personality (cloud brain)">
            <Segmented<Personality>
              value={settings.personality}
              onChange={(v) => onChange({ personality: v })}
              options={[
                { value: "classic", label: "Classic" },
                { value: "concise", label: "Concise" },
                { value: "friendly", label: "Friendly" },
              ]}
            />
          </Field>
        </Section>

        <Section title="Voice" icon={<Volume2 className="size-3.5" />}>
          <Toggle checked={settings.autoSpeak} onChange={(v) => onChange({ autoSpeak: v })} label="Speak replies aloud" hint={ttsSupported ? "Streams speech sentence by sentence." : "Speech synthesis isn't available in this browser."} />
          <Field label="Wake word" hint="Used in hands-free mode, e.g. “Jarvis, what's on my agenda?”">
            <TextField value={settings.wakeWord} onCommit={(v) => v.length >= 2 && onChange({ wakeWord: v })} maxLength={24} />
          </Field>
          <Field label="Voice">
            <select
              className="hud-input"
              value={settings.voiceName}
              onChange={(e) => onChange({ voiceName: e.target.value })}
              disabled={!ttsSupported}
            >
              <option value="" className="bg-deep">
                Auto (prefers a British male voice)
              </option>
              {sortedVoices.map((v) => (
                <option key={`${v.name}-${v.lang}`} value={v.name} className="bg-deep">
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </Field>
          <Slider label="Speed" value={settings.voiceRate} min={0.6} max={1.6} step={0.05} onCommit={(v) => onChange({ voiceRate: v })} format={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Pitch" value={settings.voicePitch} min={0.4} max={1.6} step={0.05} onCommit={(v) => onChange({ voicePitch: v })} format={(v) => v.toFixed(2)} />
          <button type="button" className="hud-btn w-full" onClick={onTestVoice} disabled={!ttsSupported}>
            <Play className="size-3.5" /> Test voice
          </button>
        </Section>

        <Section title="Data" icon={<Zap className="size-3.5" />}>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="hud-btn border-danger/40 text-danger hover:border-danger" onClick={onClearHistory}>
              <Trash2 className="size-3.5" /> Clear history
            </button>
            <button type="button" className="hud-btn border-danger/40 text-danger hover:border-danger" onClick={onClearMemory}>
              <Trash2 className="size-3.5" /> Wipe memory
            </button>
          </div>
          <p className="m-0 text-[11px] leading-relaxed text-mute">Everything is stored in your own PostgreSQL database. API keys are never stored or sent to the browser.</p>
        </Section>
      </aside>
    </div>
  );
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
