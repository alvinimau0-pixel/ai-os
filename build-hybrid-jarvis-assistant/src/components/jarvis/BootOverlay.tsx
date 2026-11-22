"use client";

import { Power } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { BrainStatus } from "@/lib/types";
import { JarvisOrb } from "./JarvisOrb";

interface Props {
  brain: BrainStatus;
  sttSupported: boolean;
  ttsSupported: boolean;
  onInit: () => void;
}

type Tone = "ok" | "warn";

const noLevel = () => 0.06;

export function BootOverlay({ brain, sttSupported, ttsSupported, onInit }: Props) {
  const [shown, setShown] = useState(0);

  const lines = useMemo<{ label: string; status: string; tone: Tone }[]>(
    () => [
      { label: "Local skill core", status: "ONLINE", tone: "ok" },
      { label: `Skill modules (${brain.skillCount})`, status: "LOADED", tone: "ok" },
      { label: "Memory & database link", status: "ONLINE", tone: "ok" },
      brain.cloudAvailable
        ? { label: `Cloud brain · ${brain.provider} · ${brain.model}`, status: "LINKED", tone: "ok" }
        : { label: "Cloud brain", status: "NOT LINKED — LOCAL ONLY", tone: "warn" },
      { label: "Speech synthesis", status: ttsSupported ? "READY" : "UNAVAILABLE", tone: ttsSupported ? "ok" : "warn" },
      { label: "Speech recognition", status: sttSupported ? "READY" : "UNAVAILABLE", tone: sttSupported ? "ok" : "warn" },
    ],
    [brain.cloudAvailable, brain.provider, brain.model, brain.skillCount, sttSupported, ttsSupported],
  );

  useEffect(() => {
    const id = window.setInterval(() => setShown((s) => Math.min(6, s + 1)), 260);
    return () => window.clearInterval(id);
  }, []);

  const ready = shown >= lines.length;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[radial-gradient(ellipse_at_center,#0b1620_0%,#04080e_72%)] p-6">
      <div className="boot-bloom" />
      <div className="relative flex w-full max-w-md flex-col items-center text-center">
        <div className="w-[min(240px,55vw)]">
          <JarvisOrb state="idle" getLevel={noLevel} />
        </div>
        <h1 className="anim-boot-title m-0 mt-2 font-hud text-2xl font-semibold tracking-[0.3em] text-white sm:text-3xl">J.A.R.V.I.S.</h1>
        <p className="anim-fade-soft m-0 mt-1.5 font-hud text-[11px] tracking-[0.08em] text-mute [animation-delay:0.6s]">Just a rather very intelligent system</p>

        <ul className="m-0 mt-6 w-full list-none space-y-1.5 p-0 text-left font-hud text-[11px]" aria-live="polite">
          {lines.slice(0, shown).map((l) => (
            <li key={l.label} className="anim-boot-line flex items-baseline gap-2">
              <span className="text-arc/60">›</span>
              <span className="min-w-0 truncate text-ink/80">{l.label}</span>
              <span className="mb-0.5 min-w-4 flex-1 border-b border-dotted border-arc/20" />
              <span className={`shrink-0 tracking-wide ${l.tone === "ok" ? "text-ok" : "text-ember"}`}>{l.status}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onInit}
          autoFocus
          disabled={!ready}
          className="hud-btn mt-7 h-12 px-8 text-[13px] tracking-[0.1em] disabled:opacity-30"
        >
          <Power className="size-4" />
          Initialize
        </button>
        <p className="m-0 mt-3 max-w-[34ch] text-[11px] leading-relaxed text-mute">
          Initializing unlocks audio and notifications so I can speak and alert you. Voice replies can be muted anytime.
        </p>
      </div>
    </div>
  );
}
