// Tiny WebAudio chime synth for UI feedback (no audio assets needed).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function unlockAudio(): void {
  getCtx();
}

export type ChimeKind = "wake" | "send" | "alert" | "error" | "boot";

interface Note {
  f: number;
  t: number;
  d: number;
  type?: OscillatorType;
  gain?: number;
}

const SEQUENCES: Record<ChimeKind, Note[]> = {
  wake: [
    { f: 660, t: 0, d: 0.09 },
    { f: 990, t: 0.09, d: 0.16 },
  ],
  send: [{ f: 540, t: 0, d: 0.06, gain: 0.08 }],
  error: [
    { f: 240, t: 0, d: 0.12, type: "sawtooth", gain: 0.1 },
    { f: 180, t: 0.12, d: 0.2, type: "sawtooth", gain: 0.1 },
  ],
  boot: [
    { f: 440, t: 0, d: 0.1 },
    { f: 660, t: 0.1, d: 0.1 },
    { f: 880, t: 0.2, d: 0.1 },
    { f: 1320, t: 0.3, d: 0.3 },
  ],
  alert: [0, 0.22, 0.44, 0.9, 1.12, 1.34].map((t) => ({ f: t < 0.8 ? 880 : 1046, t, d: 0.14, type: "triangle" as OscillatorType, gain: 0.2 })),
};

export function chime(kind: ChimeKind): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  for (const n of SEQUENCES[kind]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.type ?? "sine";
    osc.frequency.setValueAtTime(n.f, now + n.t);
    const peak = n.gain ?? 0.14;
    gain.gain.setValueAtTime(0.0001, now + n.t);
    gain.gain.exponentialRampToValueAtTime(peak, now + n.t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
    osc.connect(gain).connect(c.destination);
    osc.start(now + n.t);
    osc.stop(now + n.t + n.d + 0.03);
  }
}
