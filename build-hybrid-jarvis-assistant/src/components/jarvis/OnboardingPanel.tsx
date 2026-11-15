"use client";

import { Check, ChevronRight, Circle, Play } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { ONBOARDING_COPY } from "@/lib/onboarding/copy";
import {
  ONBOARDING_STEPS,
  completeOnboardingStep,
  detectCompletedSteps,
  dismissOnboarding,
  isOnboardingComplete,
  onboardingProgress,
  resumeOnboarding,
  type OnboardingState,
  type OnboardingStepId,
} from "@/lib/onboarding/types";
import type { BrainStatus, SettingsDTO } from "@/lib/types";

interface OnboardingPanelProps {
  state: OnboardingState;
  brain: BrainStatus;
  settings: SettingsDTO;
  hasConversation: boolean;
  onChange: (patch: Partial<SettingsDTO>) => void;
  onClose: () => void;
}

/** Settings section each incomplete step jumps to. `first-chat` has no section — it closes the drawer. */
const STEP_TARGETS: Partial<Record<OnboardingStepId, string>> = {
  brain: "settings-brain",
  identity: "settings-identity",
  voice: "settings-voice",
};

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function OnboardingPanel({ state, brain, settings, hasConversation, onChange, onClose }: OnboardingPanelProps) {
  const detected = useMemo(
    () =>
      detectCompletedSteps({
        cloudAvailable: brain.cloudAvailable,
        assistantName: settings.assistantName,
        userName: settings.userName,
        voiceName: settings.voiceName,
        autoSpeak: settings.autoSpeak,
        hasConversation,
      }),
    [brain.cloudAvailable, settings.assistantName, settings.userName, settings.voiceName, settings.autoSpeak, hasConversation],
  );

  // Keep the latest callback without re-running the sync effect on every parent render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Guards against writing the same merged state twice (e.g. when the server rejects the patch).
  const persistedRef = useRef<string | null>(null);

  useEffect(() => {
    let next = state;
    for (const step of detected) next = completeOnboardingStep(next, step);
    if (next.completedSteps.length === state.completedSteps.length && next.completedAt === state.completedAt) return;
    const fingerprint = `${next.completedSteps.slice().sort().join(",")}|${next.completedAt ?? ""}`;
    if (persistedRef.current === fingerprint) return;
    persistedRef.current = fingerprint;
    onChangeRef.current({ onboarding: next });
  }, [state, detected]);

  const complete = isOnboardingComplete(state);
  const { done, total, percent } = onboardingProgress(state);
  const paused = !!state.dismissedAt && !complete;

  const focusStep = (step: OnboardingStepId) => {
    if (state.completedSteps.includes(step)) return;
    const target = STEP_TARGETS[step];
    if (!target) {
      onClose();
      return;
    }
    scrollToSection(target);
  };

  if (paused) {
    return (
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[13px] font-medium text-ink">{ONBOARDING_COPY.title}</p>
          <p className="m-0 mt-0.5 text-[11px] leading-snug text-mute">{ONBOARDING_COPY.subtitle}</p>
        </div>
        <button type="button" className="hud-btn shrink-0 px-2.5 py-1.5 text-[11.5px]" onClick={() => onChange({ onboarding: resumeOnboarding(state) })}>
          <Play className="size-3.5" />
          {ONBOARDING_COPY.resumeLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-white/[0.06] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="hud-label m-0">{ONBOARDING_COPY.eyebrow}</p>
        <span className="text-[11px] text-mute">{ONBOARDING_COPY.progressLabel(done, total)}</span>
      </div>

      <h3 className="m-0 mt-2 text-[14px] font-medium text-ink">{complete ? ONBOARDING_COPY.completedTitle : ONBOARDING_COPY.title}</h3>
      <p className="m-0 mt-1 text-[11.5px] leading-relaxed text-mute">{complete ? ONBOARDING_COPY.completedBody : ONBOARDING_COPY.subtitle}</p>

      <div
        role="progressbar"
        aria-label={ONBOARDING_COPY.eyebrow}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full border border-white/[0.06] bg-white/[0.05]"
      >
        <div className="h-full rounded-full bg-arc transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>

      <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
        {ONBOARDING_STEPS.map((step) => {
          const copy = ONBOARDING_COPY.steps[step];
          const isDone = state.completedSteps.includes(step);
          return (
            <li key={step}>
              <button
                type="button"
                onClick={() => focusStep(step)}
                disabled={isDone}
                aria-label={isDone ? `${copy.title} — ${copy.doneLabel}` : `${copy.title} — ${copy.actionLabel}`}
                className={`flex w-full items-start gap-2.5 rounded border px-3 py-2 text-left transition ${
                  isDone
                    ? "cursor-default border-white/[0.06] bg-white/[0.02]"
                    : "border-white/[0.08] bg-arc/[0.05] hover:border-arc/40 hover:bg-arc/[0.09]"
                }`}
              >
                <span
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    isDone ? "border-ok/50 text-ok" : "border-white/15 text-mute"
                  }`}
                >
                  {isDone ? <Check className="size-3" /> : <Circle className="size-2" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-ink">{copy.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-mute">{isDone ? copy.doneLabel : copy.description}</span>
                </span>
                {!isDone && <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-mute" />}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="m-0 min-w-0 flex-1 text-[11px] leading-snug text-mute">{ONBOARDING_COPY.footerHint}</p>
        {!complete && (
          <button type="button" className="hud-btn shrink-0 px-2.5 py-1.5 text-[11.5px]" onClick={() => onChange({ onboarding: dismissOnboarding(state) })}>
            {ONBOARDING_COPY.dismissLabel}
          </button>
        )}
      </div>
    </div>
  );
}
