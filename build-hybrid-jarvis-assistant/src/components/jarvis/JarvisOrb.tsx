"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "attentive" | "alert";

const COLORS: Record<OrbState, [number, number, number]> = {
  idle: [60, 240, 255],
  listening: [80, 255, 190],
  thinking: [255, 180, 84],
  speaking: [120, 190, 255],
  attentive: [235, 255, 255],
  alert: [255, 92, 108],
};

// Counter-light: a faint indigo fill opposite the key light gives the sphere volume.
const HAZE: [number, number, number] = [99, 102, 241];

const SPEED: Record<OrbState, number> = {
  idle: 0.1,
  listening: 0.24,
  thinking: 0.85,
  speaking: 0.4,
  attentive: 0.5,
  alert: 1.5,
};

const TAU = Math.PI * 2;
const SIZE = 520;

interface Props {
  state: OrbState;
  getLevel: () => number;
  className?: string;
}

export function JarvisOrb({ state, getLevel, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  const levelRef = useRef(getLevel);

  useEffect(() => {
    stateRef.current = state;
    levelRef.current = getLevel;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const C = SIZE / 2;
    const R = SIZE / 2 - 6;
    const col: [number, number, number] = [...COLORS.idle];
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let rot = -0.9;
    let lvl = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = stateRef.current;
      const target = COLORS[st];
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * Math.min(1, dt * 5);
      if (!reduceMotion) {
        t += dt;
        rot += dt * SPEED[st];
        lvl += (levelRef.current() - lvl) * Math.min(1, dt * 12);
      }

      const rgb = `${Math.round(col[0])},${Math.round(col[1])},${Math.round(col[2])}`;
      const dim = `${Math.round(col[0] * 0.3)},${Math.round(col[1] * 0.36)},${Math.round(col[2] * 0.46)}`;
      const haze = `${HAZE[0]},${HAZE[1]},${HAZE[2]}`;
      const breathe = 1 + Math.sin(t * 1.1) * 0.014 + lvl * 0.07;
      const R0 = R * 0.56 * breathe; // sphere radius

      ctx.clearRect(0, 0, SIZE, SIZE);

      // Ambient bloom — soft light spilling into the room.
      const bloom = ctx.createRadialGradient(C, C, R0 * 0.3, C, C, R);
      bloom.addColorStop(0, `rgba(${rgb},${0.22 + lvl * 0.22})`);
      bloom.addColorStop(0.5, `rgba(${rgb},0.045)`);
      bloom.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(C, C, R, 0, TAU);
      ctx.fill();

      // Indigo counter-glow, low and to the right — the second light source.
      const counter = ctx.createRadialGradient(C + R0 * 0.55, C + R0 * 0.6, R0 * 0.1, C + R0 * 0.4, C + R0 * 0.45, R0 * 1.5);
      counter.addColorStop(0, `rgba(${haze},0.12)`);
      counter.addColorStop(1, `rgba(${haze},0)`);
      ctx.fillStyle = counter;
      ctx.beginPath();
      ctx.arc(C, C, R, 0, TAU);
      ctx.fill();

      // Sphere body — key light up-left, limb falling into shadow.
      const lx = C - R0 * 0.38;
      const ly = C - R0 * 0.46;
      const body = ctx.createRadialGradient(lx, ly, R0 * 0.06, C, C, R0);
      body.addColorStop(0, "rgba(255,255,255,0.95)");
      body.addColorStop(0.3, `rgba(${rgb},${0.68 + lvl * 0.2})`);
      body.addColorStop(0.72, `rgba(${dim},0.92)`);
      body.addColorStop(1, "rgba(10,14,20,0.94)");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(C, C, R0, 0, TAU);
      ctx.fill();

      // Rim light along the shadowed limb — indigo, barely there.
      ctx.save();
      ctx.strokeStyle = `rgba(${haze},0.35)`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.shadowColor = `rgba(${haze},0.5)`;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(C, C, R0 * 0.985, 0.15, 1.45);
      ctx.stroke();
      ctx.restore();

      // A soft band of light slowly orbiting the sphere.
      ctx.save();
      ctx.lineCap = "round";
      ctx.shadowColor = `rgba(${rgb},0.85)`;
      ctx.shadowBlur = 26;
      const bandR = R0 * 1.06;
      const span = 1.3 + lvl * 0.5;
      const grad = 14;
      for (let i = 0; i < grad; i++) {
        const a0 = rot + (i / grad) * span;
        const fade = Math.sin((i / grad) * Math.PI); // ease in and out along the band
        ctx.strokeStyle = `rgba(${rgb},${fade * (0.5 + lvl * 0.3)})`;
        ctx.lineWidth = 2.5 + fade * 2;
        ctx.beginPath();
        ctx.arc(C, C, bandR, a0, a0 + span / grad + 0.02);
        ctx.stroke();
      }
      ctx.restore();

      // While thinking or alerting, a second counter-rotating band.
      if (st === "thinking" || st === "alert") {
        ctx.save();
        ctx.lineCap = "round";
        ctx.shadowColor = `rgba(${rgb},0.7)`;
        ctx.shadowBlur = 18;
        for (let i = 0; i < grad; i++) {
          const a0 = -rot * 1.4 + Math.PI + (i / grad) * 1.0;
          const fade = Math.sin((i / grad) * Math.PI);
          ctx.strokeStyle = `rgba(${rgb},${fade * 0.26})`;
          ctx.lineWidth = 1.5 + fade;
          ctx.beginPath();
          ctx.arc(C, C, R0 * 1.14, a0, a0 + 1.0 / grad + 0.02);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Inner glow drifting with the voice level — the sphere answering you.
      const px = C + Math.cos(t * 0.6) * R0 * 0.12;
      const py = C + Math.sin(t * 0.45) * R0 * 0.1;
      const core = ctx.createRadialGradient(px, py, 0, px, py, R0 * (0.5 + lvl * 0.3));
      core.addColorStop(0, `rgba(255,255,255,${0.1 + lvl * 0.45})`);
      core.addColorStop(0.4, `rgba(${rgb},${0.08 + lvl * 0.2})`);
      core.addColorStop(1, `rgba(${rgb},0)`);
      ctx.save();
      ctx.beginPath();
      ctx.arc(C, C, R0, 0, TAU);
      ctx.clip();
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.restore();

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", aspectRatio: "1 / 1", display: "block" }} aria-hidden />;
}
