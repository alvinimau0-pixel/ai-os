"use client";

import { Cpu, Cloud, Play, Trash2, UserRound, Volume2, X, Zap } from "lucide-react";
import { useEffect } from "react";
import type { BrainBackend, BrainMode, BrainStatus, Personality, SettingsDTO, Units } from "@/lib/types";
import { OnboardingPanel } from "../OnboardingPanel";
import { Field, Segmented, Section, Slider, TextField, Toggle } from "./primitives";

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

// ------------------------------------------------------------- Settings

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  settings: SettingsDTO;
  brain: BrainStatus;
  voices: SpeechSynthesisVoice[];
  ttsSupported: boolean;
  hasConversation: boolean;
  onChange: (patch: Partial<SettingsDTO>) => void;
  onTestVoice: () => void;
  onClearHistory: () => void;
  onClearMemory: () => void;
}

const PROVIDER_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"];

export function SettingsDrawer({ open, onClose, settings, brain, voices, ttsSupported, hasConversation, onChange, onTestVoice, onClearHistory, onClearMemory }: SettingsProps) {
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

        <OnboardingPanel
          state={settings.onboarding}
          brain={brain}
          settings={settings}
          hasConversation={hasConversation}
          onChange={onChange}
          onClose={onClose}
        />

        <Section title="Brain routing" id="settings-brain" icon={<Cpu className="size-3.5" />}>
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

        <Section title="Identity" id="settings-identity" icon={<UserRound className="size-3.5" />}>
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

        <Section title="Voice" id="settings-voice" icon={<Volume2 className="size-3.5" />}>
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
