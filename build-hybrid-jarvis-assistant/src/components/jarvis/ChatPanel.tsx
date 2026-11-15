"use client";

import {
  AlarmClock,
  Calculator,
  Check,
  CloudSun,
  Ear,
  ListChecks,
  Loader2,
  Mic,
  NotebookPen,
  SendHorizontal,
  Sparkles,
  Square,
  Terminal,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ChatMessage } from "./types";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  speaking: boolean;
  addr: string;
  assistantName: string;
  wakeWord: string;
  listening: boolean;
  handsFree: boolean;
  attentive: boolean;
  interim: string;
  sttSupported: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onMic: () => void;
  onToggleHandsFree: () => void;
  className?: string;
}

interface Chip {
  label: string;
  text: string;
  send?: boolean;
}

const CHIPS: Chip[] = [
  { label: "Status report", text: "status report", send: true },
  { label: "My briefing", text: "give me my briefing", send: true },
  { label: "Weather", text: "what's the weather", send: true },
  { label: "5 min timer", text: "set a 5 minute timer", send: true },
  { label: "Add task…", text: "add task " },
  { label: "Remind me…", text: "remind me to " },
  { label: "Take a note…", text: "take a note: " },
  { label: "Tell me a joke", text: "tell me a joke", send: true },
];

const EXAMPLES: { icon: typeof ListChecks; title: string; prompt: string; send?: boolean }[] = [
  { icon: ListChecks, title: "Manage tasks", prompt: "add task review the quarterly report tomorrow at 3pm", send: true },
  { icon: AlarmClock, title: "Reminders & timers", prompt: "remind me to stretch in 20 minutes", send: true },
  { icon: NotebookPen, title: "Notes & memory", prompt: "remember that my favorite color is teal", send: true },
  { icon: Calculator, title: "Math & units", prompt: "what's 18% of 240 plus 15?", send: true },
  { icon: CloudSun, title: "Weather & time", prompt: "time in Tokyo", send: true },
  { icon: Terminal, title: "Everything else", prompt: "what can you do", send: true },
];

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-white/[0.07] px-1 py-0.5 font-mono text-[0.85em] text-arc/90">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function Rich({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        const bullet = line.match(/^\s*[•*-]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-arc/70" />
              <span className="min-w-0 break-words">{inline(bullet[1])}</span>
            </div>
          );
        }
        return (
          <p key={i} className="m-0 break-words">
            {inline(line)}
          </p>
        );
      })}
    </div>
  );
}

function Bubble({ m, assistantName }: { m: ChatMessage; assistantName: string }) {
  if (m.role === "user") {
    return (
      <div className="anim-fade-up flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-white/10 bg-white/[0.07] px-3.5 py-2.5 text-[14px] leading-relaxed text-ink">
          {m.content}
        </div>
      </div>
    );
  }
  const badge =
    m.source === "cloud"
      ? { label: `cloud${m.model ? ` · ${m.model}` : ""}`, cls: "border-violet-400/25 text-violet-300/90" }
      : m.source === "system"
        ? { label: "alert", cls: "border-amber-400/25 text-amber-300/90" }
        : m.source === "local"
          ? { label: `local${m.skill ? ` · ${m.skill}` : ""}`, cls: "border-white/15 text-mute" }
          : null;

  return (
    <div className="anim-fade-up flex gap-2.5">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
        <span className="size-2 rounded-full bg-arc/70" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="hud-label">{assistantName}</span>
          {badge && <span className={`rounded border px-1.5 py-px text-[10px] ${badge.cls}`}>{badge.label}</span>}
        </div>
        {m.tools && m.tools.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {m.tools.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-300">
                {t.status === "running" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-ok" />}
                <Wrench className="size-3 opacity-60" />
                {t.name.replace(/_/g, " ")}
                {t.summary && t.status === "done" && <span className="max-w-[16ch] truncate text-zinc-500">· {t.summary}</span>}
              </span>
            ))}
          </div>
        )}
        <div className={`text-[14px] leading-relaxed ${m.error ? "text-danger" : "text-ink"}`}>
          {m.content ? (
            <>
              <Rich text={m.content} />
              {m.streaming && <span className="anim-blink ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-arc" />}
            </>
          ) : m.streaming ? (
            <span className="inline-flex h-5 items-center" aria-label="Thinking">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({
  messages,
  busy,
  speaking,
  addr,
  assistantName,
  wakeWord,
  listening,
  handsFree,
  attentive,
  interim,
  sttSupported,
  onSend,
  onStop,
  onMic,
  onToggleHandsFree,
  className = "",
}: Props) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [messages, busy]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) {
      if (busy || speaking) onStop();
      return;
    }
    onSend(v);
    setText("");
  };

  const applyChip = (c: Chip) => {
    if (c.send) onSend(c.text);
    else {
      setText(c.text);
      inputRef.current?.focus();
    }
  };

  const showStop = (busy || speaking) && !text.trim();
  const micActive = listening && !handsFree;

  return (
    <section className={`hud-panel flex min-h-0 flex-col ${className}`}>
      <div ref={scroller} className="hud-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-4" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center py-4">
            <p className="hud-label m-0 mb-2 flex items-center gap-2">
              <Sparkles className="size-3.5" /> Online and standing by
            </p>
            <h1 className="m-0 mb-1 text-2xl font-light tracking-tight text-white sm:text-3xl">At your service, {addr}.</h1>
            <p className="m-0 mb-5 text-sm leading-relaxed text-mute">
              Type below, press the microphone, or enable hands-free and say “{wakeWord.charAt(0).toUpperCase() + wakeWord.slice(1)}”. Try one of these:
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.title}
                  type="button"
                  onClick={() => (ex.send ? onSend(ex.prompt) : setText(ex.prompt))}
                  className="group rounded-lg border border-white/[0.07] bg-white/[0.03] p-3 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <span className="flex items-center gap-2 text-mute">
                    <ex.icon className="size-4" />
                    <span className="hud-label">{ex.title}</span>
                  </span>
                  <span className="mt-1.5 block text-[13px] leading-snug text-ink/80 group-hover:text-ink">“{ex.prompt}”</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} assistantName={assistantName} />)
        )}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-white/[0.06] p-2.5">
        {interim && (
          <div className="mb-2 truncate rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-ink/80" aria-live="polite">
            “{interim}”
          </div>
        )}
        <div className="hud-scroll -mx-0.5 mb-2 flex gap-1.5 overflow-x-auto px-0.5 pb-1">
          {CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => applyChip(c)}
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-ink/70 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-ink"
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMic}
            disabled={!sttSupported}
            title={sttSupported ? (handsFree ? "Hands-free is on — tap to get my attention" : "Tap to speak") : "Speech recognition isn't supported in this browser"}
            aria-label="Speak"
            aria-pressed={micActive}
            className={`relative grid size-11 shrink-0 place-items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40 ${
              attentive
                ? "anim-pulse-ring border-white bg-white/20 text-white"
                : micActive
                  ? "anim-pulse-ring-ok border-ok bg-ok/15 text-ok"
                  : "border-arc/40 bg-arc/10 text-arc hover:bg-arc/20"
            }`}
          >
            <Mic className="size-5" />
          </button>
          <button
            type="button"
            onClick={onToggleHandsFree}
            disabled={!sttSupported}
            data-active={handsFree}
            title={`Hands-free: say “${wakeWord}” followed by a command`}
            aria-pressed={handsFree}
            className="hud-btn h-11 shrink-0 px-2.5"
          >
            <Ear className="size-4" />
            <span className="hidden sm:inline">{handsFree ? "Listening" : "Wake"}</span>
          </button>
          <input
            ref={inputRef}
            className="hud-input h-11 min-w-0 flex-1 text-[14px]"
            placeholder={handsFree ? `Say “${wakeWord}…” or type here` : `Message ${assistantName}…`}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            aria-label="Message"
            autoComplete="off"
            enterKeyHint="send"
          />
          <button
            type="submit"
            className={`hud-btn h-11 w-11 shrink-0 px-0 ${showStop ? "border-danger/50 text-danger hover:border-danger" : ""}`}
            aria-label={showStop ? "Stop" : "Send"}
            disabled={!showStop && !text.trim()}
          >
            {showStop ? <Square className="size-4 fill-current" /> : <SendHorizontal className="size-4" />}
          </button>
        </div>
      </form>
    </section>
  );
}
