"use client";

import { History, ListChecks, MessageSquarePlus, NotebookPen, Settings, Volume2, VolumeX } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import type { BrainMode, BrainStatus, SettingsDTO } from "@/lib/types";

interface Props {
  brain: BrainStatus;
  settings: SettingsDTO;
  sessionTitle: string | null;
  onMode: (mode: BrainMode) => void;
  onSessions: () => void;
  onNewSession: () => void;
  onToggleVoice: () => void;
  onAgenda: () => void;
  onIntel: () => void;
  onSettings: () => void;
}

function Clock() {
  const now = useNow(1000);
  return (
    <div className="hidden text-right leading-tight sm:block" suppressHydrationWarning>
      <div className="text-sm tabular-nums text-ink">
        {now === null ? "--:--:--" : new Date(now).toLocaleTimeString([], { hour12: false })}
      </div>
      <div className="text-[10px] text-mute">
        {now === null ? "" : new Date(now).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
      </div>
    </div>
  );
}

export function TopBar({ brain, settings, sessionTitle, onMode, onSessions, onNewSession, onToggleVoice, onAgenda, onIntel, onSettings }: Props) {
  const effective: BrainMode = brain.cloudAvailable ? settings.brainMode : "local";
  const modes: { value: BrainMode; label: string }[] = [
    { value: "local", label: "Local" },
    { value: "hybrid", label: "Hybrid" },
    { value: "cloud", label: "Cloud" },
  ];

  return (
    <header className="relative z-20 flex shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#0b0c0f]/90 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className="size-2.5 rounded-full bg-arc" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-[0.18em] text-white">J.A.R.V.I.S.</div>
          <div className="hidden text-[9px] uppercase tracking-[0.2em] text-mute sm:block">Hybrid AI assistant</div>
        </div>
      </div>

      <div className="ml-1 hidden items-center gap-3 md:flex">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Brain routing">
          {modes.map((m) => {
            const disabled = m.value !== "local" && !brain.cloudAvailable;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={effective === m.value}
                data-active={effective === m.value}
                disabled={disabled}
                title={disabled ? "Link a cloud brain (API key) to enable" : `Route: ${m.label}`}
                onClick={() => onMode(m.value)}
                className="hud-btn px-2 py-1 text-[11px]"
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <div className="hidden items-center gap-3 text-[11px] lg:flex">
          <span className="flex items-center gap-1.5 text-ok">
            <span className="size-1.5 rounded-full bg-current" /> Core
          </span>
          <span className={`flex items-center gap-1.5 ${brain.cloudAvailable ? "text-violet-300/90" : "text-mute"}`}>
            <span className="size-1.5 rounded-full bg-current" />
            {brain.cloudAvailable ? `Cloud · ${brain.model}` : "Cloud offline"}
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {sessionTitle && <span className="mr-1 hidden max-w-[22ch] truncate text-[11px] text-mute xl:block">{sessionTitle}</span>}
        <Clock />
        <span className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
        <button type="button" onClick={onAgenda} className="hud-icon-btn" aria-label="Agenda: tasks and reminders" title="Agenda">
          <ListChecks className="size-4" />
        </button>
        <button type="button" onClick={onIntel} className="hud-icon-btn" aria-label="Intel: notes and memory" title="Intel">
          <NotebookPen className="size-4" />
        </button>
        <button type="button" onClick={onNewSession} className="hud-icon-btn" aria-label="New session" title="New session">
          <MessageSquarePlus className="size-4" />
        </button>
        <button type="button" onClick={onSessions} className="hud-icon-btn" aria-label="Session history" title="Session history">
          <History className="size-4" />
        </button>
        <button type="button" onClick={onToggleVoice} className="hud-icon-btn" aria-label={settings.autoSpeak ? "Mute voice replies" : "Enable voice replies"} aria-pressed={settings.autoSpeak} title={settings.autoSpeak ? "Voice replies on" : "Voice replies off"}>
          {settings.autoSpeak ? <Volume2 className="size-4" /> : <VolumeX className="size-4 text-mute" />}
        </button>
        <button type="button" onClick={onSettings} className="hud-icon-btn" aria-label="Settings" title="Settings">
          <Settings className="size-4" />
        </button>
      </div>
    </header>
  );
}
