"use client";

import { AlarmClock, Bell, Check, Circle, CircleCheck, Flame, ListChecks, Plus, Timer, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNow } from "@/hooks/useNow";
import { fmtClock, fmtCountdown, fmtDue, fmtIn } from "@/lib/format";
import type { ReminderDTO, TaskDTO } from "@/lib/types";
import { EmptyState, Panel } from "./Panel";

// ------------------------------------------------------------------ Tasks

interface TasksProps {
  tasks: TaskDTO[];
  onAdd: (title: string) => void;
  onToggle: (t: TaskDTO) => void;
  onDelete: (id: number) => void;
  onPriority: (t: TaskDTO) => void;
  onClearDone: () => void;
  className?: string;
}

export function TasksPanel({ tasks, onAdd, onToggle, onDelete, onPriority, onClearDone, className }: TasksProps) {
  const [title, setTitle] = useState("");
  const now = useNow(30000);
  const openCount = tasks.filter((t) => !t.done).length;
  const doneCount = tasks.length - openCount;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = title.trim();
    if (!v) return;
    onAdd(v);
    setTitle("");
  };

  return (
    <Panel
      title="Tasks"
      icon={ListChecks}
      className={className}
      bodyClassName="flex flex-col"
      right={<span className="text-[10px] text-mute">{openCount} open</span>}
    >
      <form onSubmit={submit} className="flex shrink-0 gap-2 p-2">
        <input
          className="hud-input"
          placeholder="Add a task…"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="New task"
        />
        <button type="submit" className="hud-btn shrink-0" aria-label="Add task">
          <Plus className="size-3.5" />
        </button>
      </form>
      <ul className="hud-scroll m-0 min-h-0 flex-1 list-none space-y-0.5 overflow-y-auto px-2 pb-2">
        {tasks.length === 0 && (
          <li>
            <EmptyState icon={ListChecks}>Nothing pending. Say “add task …” or type above.</EmptyState>
          </li>
        )}
        {tasks.map((t) => (
          <li key={t.id} className="group flex items-start gap-2 rounded border border-transparent px-1.5 py-1.5 transition hover:border-white/10 hover:bg-white/[0.03]">
            <button
              type="button"
              onClick={() => onToggle(t)}
              className="mt-0.5 shrink-0 text-mute transition hover:text-ink"
              aria-label={t.done ? "Mark as not done" : "Mark as done"}
            >
              {t.done ? <CircleCheck className="size-4 text-ok" /> : <Circle className="size-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`m-0 break-words text-[13px] leading-snug ${t.done ? "text-mute line-through" : "text-ink"}`}>{t.title}</p>
              {t.dueAt && now !== null && !t.done && (
                <p className={`m-0 mt-0.5 text-[10px] ${new Date(t.dueAt).getTime() < now ? "text-danger" : "text-ember"}`}>
                  Due {fmtDue(t.dueAt, now)}
                </p>
              )}
            </div>
            {!t.done && (
              <button
                type="button"
                onClick={() => onPriority(t)}
                className={`shrink-0 transition ${t.priority === "high" ? "text-danger" : "text-mute/50 opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"}`}
                aria-label={t.priority === "high" ? "Remove high priority" : "Mark high priority"}
                title="Toggle high priority"
              >
                <Flame className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(t.id)}
              className="shrink-0 text-mute/50 opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100"
              aria-label="Delete task"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {doneCount > 0 && (
        <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.06] px-3 py-1.5 text-[11px] text-mute">
          <span>{doneCount} completed</span>
          <button type="button" onClick={onClearDone} className="text-mute hover:text-ink">
            Clear
          </button>
        </footer>
      )}
    </Panel>
  );
}

// ------------------------------------------------- Reminders & timers

interface RemindersProps {
  reminders: ReminderDTO[];
  onAddTimer: (seconds: number) => void;
  onAddReminder: (label: string, minutes: number) => void;
  onDismiss: (id: number) => void;
  onDelete: (id: number) => void;
  className?: string;
}

const QUICK_TIMERS: [number, string][] = [
  [60, "1m"],
  [300, "5m"],
  [600, "10m"],
  [1500, "25m"],
];

const REMIND_IN: [number, string][] = [
  [5, "5 min"],
  [15, "15 min"],
  [30, "30 min"],
  [60, "1 hour"],
  [180, "3 hours"],
  [1440, "Tomorrow"],
];

function Ring({ progress }: { progress: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0 -rotate-90" aria-hidden>
      <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke="#22d3ee"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
        style={{ filter: "drop-shadow(0 0 2px rgba(34,211,238,0.45))", transition: "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}

export function RemindersPanel({ reminders, onAddTimer, onAddReminder, onDismiss, onDelete, className }: RemindersProps) {
  const now = useNow(1000);
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState(15);

  const pending = reminders.filter((r) => r.status === "pending");
  const fired = reminders.filter((r) => r.status === "fired");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = label.trim();
    if (!v) return;
    onAddReminder(v, minutes);
    setLabel("");
  };

  return (
    <Panel
      title="Alerts & timers"
      icon={AlarmClock}
      className={className}
      bodyClassName="flex flex-col"
      right={<span className="text-[10px] text-mute">{pending.length} active</span>}
    >
      <div className="shrink-0 space-y-2 p-2">
        <div className="flex items-center gap-1.5">
          <Timer className="size-3.5 shrink-0 text-mute" />
          {QUICK_TIMERS.map(([sec, text]) => (
            <button key={sec} type="button" className="hud-btn flex-1 px-1 py-1" onClick={() => onAddTimer(sec)} aria-label={`Start ${text} timer`}>
              {text}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex gap-1.5">
          <input className="hud-input min-w-0" placeholder="Remind me to…" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} aria-label="Reminder text" />
          <select className="hud-input w-auto shrink-0 px-1.5" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Remind in">
            {REMIND_IN.map(([m, text]) => (
              <option key={m} value={m} className="bg-deep">
                {text}
              </option>
            ))}
          </select>
          <button type="submit" className="hud-btn shrink-0" aria-label="Add reminder">
            <Plus className="size-3.5" />
          </button>
        </form>
      </div>

      <ul className="hud-scroll m-0 min-h-0 flex-1 list-none space-y-1 overflow-y-auto px-2 pb-2">
        {pending.length === 0 && fired.length === 0 && (
          <li>
            <EmptyState icon={Bell}>No active alerts. Say “remind me to … in 10 minutes”.</EmptyState>
          </li>
        )}
        {pending.map((r) => {
          const due = new Date(r.dueAt).getTime();
          const left = now === null ? null : (due - now) / 1000;
          const isTimer = r.kind === "timer";
          const progress = isTimer && r.durationSec && left !== null ? 1 - left / r.durationSec : 0;
          return (
            <li key={r.id} className="group flex items-center gap-2.5 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
              {isTimer ? <Ring progress={progress} /> : <Bell className="size-4 shrink-0 text-ember" />}
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[13px] text-ink">{r.label}</p>
                <p className="m-0 text-[10px] text-mute">
                  {left === null ? "—" : isTimer ? <span className="text-arc">{fmtCountdown(left)}</span> : <>in {fmtIn(left)}</>}
                  {!isTimer && now !== null && <span> · {fmtClock(due)}</span>}
                </p>
              </div>
              <button type="button" onClick={() => onDelete(r.id)} className="shrink-0 text-mute/60 opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label="Cancel">
                <X className="size-3.5" />
              </button>
            </li>
          );
        })}
        {fired.map((r) => (
          <li key={r.id} className="flex items-center gap-2.5 rounded border border-transparent px-2 py-1.5 opacity-60">
            <Check className="size-4 shrink-0 text-ok" />
            <p className="m-0 min-w-0 flex-1 truncate text-[12px] text-mute line-through">{r.label}</p>
            <button type="button" onClick={() => onDismiss(r.id)} className="shrink-0 text-mute hover:text-ink" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
