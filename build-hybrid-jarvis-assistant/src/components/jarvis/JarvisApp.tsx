"use client";

import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoice } from "@/hooks/useVoice";
import { api } from "@/lib/api";
import { chime, unlockAudio } from "@/lib/audio";
import type {
  BootstrapData,
  BrainMode,
  BrainStatus,
  ClientCommand,
  ConversationDTO,
  MemoryDTO,
  MessageDTO,
  NoteDTO,
  ReminderDTO,
  ResourceKey,
  SettingsDTO,
  StreamEvent,
  TaskDTO,
} from "@/lib/types";
import { BootOverlay } from "./BootOverlay";
import { ChatPanel } from "./ChatPanel";
import { AgendaDrawer, IntelDrawer, SessionsDrawer, SettingsDrawer } from "./Drawers";
import { JarvisOrb, type OrbState } from "./JarvisOrb";
import { TopBar } from "./TopBar";
import { toChat, type ChatMessage, type Toast } from "./types";

const STOP_RE = /^(?:stop|be quiet|quiet|silence|enough|that'?s enough|stop talking|hush|never ?mind)[.!]?$/i;

const STATUS_COLOR: Record<OrbState, string> = {
  idle: "text-arc/80",
  listening: "text-ok",
  thinking: "text-ember",
  speaking: "text-sky-300",
  attentive: "text-white",
  alert: "text-danger",
};

const TOAST_STYLE: Record<Toast["tone"], string> = {
  info: "border-arc/40 text-ink",
  ok: "border-ok/50 text-ok",
  warn: "border-ember/50 text-ember",
  alert: "border-danger/60 text-danger anim-pulse-ring-red",
};

export default function JarvisApp({ initial }: { initial: BootstrapData }) {
  const [settings, setSettings] = useState<SettingsDTO>(initial.settings);
  const [brain, setBrain] = useState<BrainStatus>(initial.brain);
  const [tasks, setTasks] = useState<TaskDTO[]>(initial.tasks);
  const [notes, setNotes] = useState<NoteDTO[]>(initial.notes);
  const [reminders, setReminders] = useState<ReminderDTO[]>(initial.reminders);
  const [memories, setMemories] = useState<MemoryDTO[]>(initial.memories);
  const [conversations, setConversations] = useState<ConversationDTO[]>(initial.conversations);
  const [activeId, setActiveId] = useState<number | null>(initial.activeConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => initial.messages.map(toChat));
  const [busy, setBusy] = useState(false);
  const [booted, setBooted] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [intelOpen, setIntelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const activeIdRef = useRef<number | null>(activeId);
  const settingsRef = useRef(settings);
  const remindersRef = useRef(reminders);
  const abortRef = useRef<AbortController | null>(null);
  const toastSeq = useRef(0);
  const firing = useRef(new Set<number>());
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const announceRef = useRef<(r: ReminderDTO, lateMs: number) => void>(() => undefined);

  useEffect(() => {
    activeIdRef.current = activeId;
    settingsRef.current = settings;
    remindersRef.current = reminders;
  });

  const addr = settings.userName.trim() || "sir";

  const toast = useCallback((text: string, tone: Toast["tone"] = "info", ms = 5000) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const voice = useVoice({
    settings,
    onTranscript: (t) => sendRef.current(t),
    onNotice: (m) => toast(m, "warn", 7000),
  });

  // ------------------------------------------------------------ data sync

  const refresh = useCallback(async (keys: ResourceKey[]) => {
    await Promise.all(
      Array.from(new Set(keys)).map(async (k) => {
        try {
          switch (k) {
            case "tasks":
              setTasks(await api<TaskDTO[]>("/api/tasks"));
              break;
            case "notes":
              setNotes(await api<NoteDTO[]>("/api/notes"));
              break;
            case "reminders":
              setReminders(await api<ReminderDTO[]>("/api/reminders"));
              break;
            case "memories":
              setMemories(await api<MemoryDTO[]>("/api/memories"));
              break;
            case "conversations":
              setConversations(await api<ConversationDTO[]>("/api/conversations"));
              break;
            case "settings": {
              const r = await api<{ settings: SettingsDTO; brain: BrainStatus }>("/api/settings");
              setSettings(r.settings);
              setBrain(r.brain);
              break;
            }
          }
        } catch {
          /* transient network error — next refresh will catch up */
        }
      }),
    );
  }, []);

  const mutate = async (fn: () => Promise<unknown>, keys: ResourceKey[], fallback = "That didn't work") => {
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : fallback, "warn");
    }
    await refresh(keys);
  };

  // Keep alerts in sync if they're created from another tab/device.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh(["reminders"]);
    }, 20000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // ------------------------------------------------------- reminder firing

  const announce = (r: ReminderDTO, lateMs: number) => {
    const s = settingsRef.current;
    const who = s.userName.trim() || "sir";
    const isTimer = r.kind === "timer";
    const named = !!r.label && r.label !== "Timer";
    const late = lateMs > 120000;
    const mins = Math.round(lateMs / 60000);
    const title = isTimer ? `${named ? `${r.label} timer` : "Timer"} complete` : r.label;
    const icon = isTimer ? "⏱" : "⏰";
    const spoken = late
      ? `${who}, you missed a ${isTimer ? "timer" : "reminder"} from ${mins} minutes ago: ${r.label}.`
      : isTimer
        ? `${who}, your ${named ? `${r.label} ` : ""}timer is complete.`
        : `${who}, reminder: ${r.label}.`;

    chime("alert");
    toast(`${icon} ${title}`, "alert", 15000);
    setAlerting(true);
    window.setTimeout(() => setAlerting(false), 5000);
    setMessages((m) => [
      ...m,
      {
        id: `sys-${r.id}-${Date.now()}`,
        role: "assistant",
        source: "system",
        content: late ? `${icon} Missed ${isTimer ? "timer" : "reminder"} (${mins} min ago): ${r.label}` : `${icon} ${title}`,
      },
    ]);
    if (s.autoSpeak) window.setTimeout(() => voice.speech.say(spoken), 1700);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification(title, { body: isTimer ? "Your timer has finished." : "Reminder", tag: `jarvis-${r.id}` });
      }
    } catch {
      /* notifications unavailable */
    }
  };

  useEffect(() => {
    announceRef.current = announce;
  });

  useEffect(() => {
    if (!booted) return;
    const tick = async () => {
      const now = Date.now();
      for (const r of remindersRef.current) {
        if (r.status !== "pending" || firing.current.has(r.id)) continue;
        const due = new Date(r.dueAt).getTime();
        if (due > now) continue;
        firing.current.add(r.id);
        try {
          const res = await api<{ changed: boolean }>("/api/reminders", { method: "PATCH", json: { id: r.id, status: "fired" } });
          if (res.changed) announceRef.current(r, now - due);
        } catch {
          firing.current.delete(r.id);
          continue;
        }
        void refresh(["reminders"]);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => window.clearInterval(id);
  }, [booted, refresh]);

  // ----------------------------------------------------------- chat engine

  const startNewSession = () => {
    abortRef.current?.abort();
    voice.speech.cancel();
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setBusy(false);
  };

  const stopEverything = () => {
    voice.speech.cancel();
    abortRef.current?.abort();
  };

  const sendMessage = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    if (STOP_RE.test(message)) {
      stopEverything();
      return;
    }

    abortRef.current?.abort();
    voice.speech.cancel();
    chime("send");

    const stamp = Date.now();
    const botId = `a-${stamp}`;
    setMessages((m) => [...m, { id: `u-${stamp}`, role: "user", content: message }, { id: botId, role: "assistant", content: "", streaming: true }]);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;
    const speak = settingsRef.current.autoSpeak;
    if (speak) voice.speech.begin();

    const patchBot = (fn: (m: ChatMessage) => ChatMessage) => setMessages((ms) => ms.map((m) => (m.id === botId ? fn(m) : m)));
    let newSession = false;

    const handleClient = (cmd: ClientCommand) => {
      if (cmd.type === "stop_speaking") voice.speech.cancel();
      else if (cmd.type === "set_autospeak") {
        setSettings((s) => ({ ...s, autoSpeak: cmd.value }));
        if (!cmd.value) voice.speech.cancel();
      } else if (cmd.type === "new_session") newSession = true;
    };

    const handleEvent = (ev: StreamEvent) => {
      switch (ev.type) {
        case "start":
          patchBot((m) => ({ ...m, source: ev.route, model: ev.model ?? null }));
          if (activeIdRef.current !== ev.conversationId) {
            activeIdRef.current = ev.conversationId;
            setActiveId(ev.conversationId);
          }
          break;
        case "skill":
          patchBot((m) => ({ ...m, skill: ev.name }));
          break;
        case "tool":
          patchBot((m) => {
            const tools = [...(m.tools ?? [])];
            if (ev.status === "running") tools.push({ name: ev.name, status: "running" });
            else {
              for (let i = tools.length - 1; i >= 0; i--) {
                if (tools[i].name === ev.name && tools[i].status === "running") {
                  tools[i] = { ...tools[i], status: "done", summary: ev.summary };
                  break;
                }
              }
            }
            return { ...m, tools };
          });
          break;
        case "delta":
          patchBot((m) => ({ ...m, content: m.content + ev.text }));
          if (speak) voice.speech.feed(ev.text);
          break;
        case "refresh":
          void refresh(ev.resources);
          break;
        case "client":
          handleClient(ev.command);
          break;
        case "done":
          void refresh(["conversations"]);
          break;
        case "error":
          patchBot((m) => ({ ...m, error: true, content: m.content || ev.message }));
          chime("error");
          break;
      }
    };

    let aborted = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId: activeIdRef.current,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } catch (err) {
      if (ac.signal.aborted) aborted = true;
      else {
        const msg = err instanceof Error ? err.message : "Connection lost";
        patchBot((m) => ({ ...m, error: true, content: m.content || `I couldn't reach my core systems (${msg}). Please try again.` }));
        chime("error");
      }
    } finally {
      patchBot((m) => ({ ...m, streaming: false }));
      if (aborted) setMessages((ms) => ms.filter((m) => !(m.id === botId && !m.content)));
      if (abortRef.current === ac) {
        abortRef.current = null;
        setBusy(false);
        if (speak) voice.speech.end();
      }
      if (newSession) window.setTimeout(startNewSession, 1400);
    }
  };

  useEffect(() => {
    sendRef.current = (t: string) => void sendMessage(t);
  });

  // --------------------------------------------------------------- actions

  const changeSettings = async (patch: Partial<SettingsDTO>) => {
    setSettings((s) => ({ ...s, ...patch }));
    try {
      const r = await api<{ settings: SettingsDTO; brain: BrainStatus }>("/api/settings", { method: "PUT", json: patch });
      setSettings(r.settings);
      setBrain(r.brain);
    } catch {
      toast("Couldn't save settings", "warn");
      void refresh(["settings"]);
    }
  };

  const selectSession = async (id: number) => {
    if (id === activeIdRef.current) return;
    abortRef.current?.abort();
    voice.speech.cancel();
    try {
      const r = await api<{ conversation: ConversationDTO; messages: MessageDTO[] }>(`/api/conversations?id=${id}`);
      activeIdRef.current = id;
      setActiveId(id);
      setMessages(r.messages.map(toChat));
      setBusy(false);
    } catch {
      toast("Couldn't load that session", "warn");
    }
  };

  const deleteSession = async (id: number) => {
    await mutate(() => api(`/api/conversations?id=${id}`, { method: "DELETE" }), ["conversations"]);
    if (id === activeIdRef.current) startNewSession();
  };

  const clearHistory = async () => {
    if (!window.confirm("Delete all conversation history?")) return;
    await mutate(() => api("/api/conversations?all=1", { method: "DELETE" }), ["conversations"]);
    startNewSession();
    toast("Conversation history cleared", "ok");
  };

  const clearMemory = async () => {
    if (!window.confirm("Wipe everything I remember about you?")) return;
    await mutate(() => api("/api/memories?all=1", { method: "DELETE" }), ["memories"]);
    toast("Memory wiped", "ok");
  };

  const init = () => {
    unlockAudio();
    chime("boot");
    setBooted(true);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
    } catch {
      /* ignore */
    }
    if (settings.autoSpeak) {
      const hour = new Date().getHours();
      const pod = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
      const hello = `Good ${pod}, ${addr}. ${settings.assistantName} online. ${brain.cloudAvailable ? "Cloud link established." : "Running on the local core."} How may I assist?`;
      window.setTimeout(() => voice.speech.say(hello), 700);
    }
  };

  // ---------------------------------------------------------------- render

  const orbState: OrbState = alerting
    ? "alert"
    : voice.speaking
      ? "speaking"
      : busy
        ? "thinking"
        : voice.attentive
          ? "attentive"
          : voice.listening && !voice.handsFree
            ? "listening"
            : "idle";

  const statusText: Record<OrbState, string> = {
    alert: "ALERT",
    speaking: "SPEAKING",
    thinking: "PROCESSING",
    attentive: "I'M LISTENING",
    listening: "LISTENING",
    idle: voice.handsFree ? `AWAITING “${settings.wakeWord.toUpperCase()}”` : "STANDING BY",
  };

  const sessionTitle = conversations.find((c) => c.id === activeId)?.title ?? null;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <TopBar
        brain={brain}
        settings={settings}
        sessionTitle={sessionTitle}
        onMode={(mode: BrainMode) => void changeSettings({ brainMode: mode })}
        onSessions={() => setSessionsOpen(true)}
        onNewSession={startNewSession}
        onToggleVoice={() => {
          if (settings.autoSpeak) voice.speech.cancel();
          void changeSettings({ autoSpeak: !settings.autoSpeak });
        }}
        onAgenda={() => setAgendaOpen(true)}
        onIntel={() => setIntelOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-[780px] flex-1 flex-col gap-4 px-3 pb-3 pt-2">
        <div className="flex shrink-0 flex-col items-center">
          <div className="w-[clamp(110px,23vh,240px)]">
            <JarvisOrb state={orbState} getLevel={voice.getLevel} />
          </div>
          <div className={`-mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] ${STATUS_COLOR[orbState]}`} aria-live="polite">
            <span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
            {statusText[orbState]}
          </div>
        </div>
        <ChatPanel
          className="min-h-0 flex-1"
          messages={messages}
          busy={busy}
          speaking={voice.speaking}
          addr={addr}
          assistantName={settings.assistantName}
          wakeWord={settings.wakeWord}
          listening={voice.listening}
          handsFree={voice.handsFree}
          attentive={voice.attentive}
          interim={voice.interim}
          sttSupported={voice.sttSupported}
          onSend={(t) => void sendMessage(t)}
          onStop={stopEverything}
          onMic={voice.pushToTalk}
          onToggleHandsFree={() => voice.setHandsFree(!voice.handsFree)}
        />
      </main>

      <div className="pointer-events-none fixed right-3 top-16 z-[65] flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`anim-fade-up pointer-events-auto flex items-start gap-2.5 rounded border bg-deep/95 px-3 py-2.5 text-[13px] shadow-xl backdrop-blur ${TOAST_STYLE[t.tone]}`}>
            {t.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            <span className="min-w-0 flex-1 break-words">{t.text}</span>
            <button type="button" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <AgendaDrawer
        open={agendaOpen}
        onClose={() => setAgendaOpen(false)}
        tasks={tasks}
        reminders={reminders}
        onAddTask={(title) => void mutate(() => api("/api/tasks", { method: "POST", json: { title } }), ["tasks"], "Couldn't add the task")}
        onToggleTask={(t) => {
          setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
          void mutate(() => api("/api/tasks", { method: "PATCH", json: { id: t.id, done: !t.done } }), ["tasks"]);
        }}
        onPriorityTask={(t) => void mutate(() => api("/api/tasks", { method: "PATCH", json: { id: t.id, priority: t.priority === "high" ? "normal" : "high" } }), ["tasks"])}
        onDeleteTask={(id) => void mutate(() => api(`/api/tasks?id=${id}`, { method: "DELETE" }), ["tasks"])}
        onClearDoneTasks={() => void mutate(() => api("/api/tasks?completed=1", { method: "DELETE" }), ["tasks"])}
        onAddTimer={(sec) => {
          chime("send");
          void mutate(() => api("/api/reminders", { method: "POST", json: { kind: "timer", label: "Timer", durationSec: sec } }), ["reminders"]);
        }}
        onAddReminder={(label, minutes) =>
          void mutate(
            () => api("/api/reminders", { method: "POST", json: { kind: "reminder", label, dueAt: new Date(Date.now() + minutes * 60000).toISOString() } }),
            ["reminders"],
          )
        }
        onDismissReminder={(id) => void mutate(() => api("/api/reminders", { method: "PATCH", json: { id, status: "dismissed" } }), ["reminders"])}
        onDeleteReminder={(id) => void mutate(() => api(`/api/reminders?id=${id}`, { method: "DELETE" }), ["reminders"])}
      />
      <IntelDrawer
        open={intelOpen}
        onClose={() => setIntelOpen(false)}
        notes={notes}
        memories={memories}
        brain={brain}
        settings={settings}
        sttSupported={voice.sttSupported}
        ttsSupported={voice.ttsSupported}
        handsFree={voice.handsFree}
        onAddNote={(content) => void mutate(() => api("/api/notes", { method: "POST", json: { content } }), ["notes"])}
        onDeleteNote={(id) => void mutate(() => api(`/api/notes?id=${id}`, { method: "DELETE" }), ["notes"])}
        onAddMemory={(content) => void mutate(() => api("/api/memories", { method: "POST", json: { content } }), ["memories"])}
        onDeleteMemory={(id) => void mutate(() => api(`/api/memories?id=${id}`, { method: "DELETE" }), ["memories"])}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SessionsDrawer
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => void selectSession(id)}
        onDelete={(id) => void deleteSession(id)}
        onNew={startNewSession}
      />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        brain={brain}
        voices={voice.voices}
        ttsSupported={voice.ttsSupported}
        onChange={(patch) => void changeSettings(patch)}
        onTestVoice={() => voice.speech.say(`${settings.assistantName} online. This is how I sound, ${addr}.`)}
        onClearHistory={() => void clearHistory()}
        onClearMemory={() => void clearMemory()}
      />

      {!booted && <BootOverlay brain={brain} sttSupported={voice.sttSupported} ttsSupported={voice.ttsSupported} onInit={init} />}
    </div>
  );
}
