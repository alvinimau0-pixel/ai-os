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

const SPEED: Record<OrbState, number> = {
  idle: 0.25,
  listening: 0.5,
  thinking: 1.6,
  speaking: 0.7,
  attentive: 0.9,
  alert: 2.4,
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

    const C = SIZE / 2;
    const R = SIZE / 2 - 6;
    const col: [number, number, number] = [...COLORS.idle];
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let rot = 0;
    let lvl = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const st = stateRef.current;
      const target = COLORS[st];
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * Math.min(1, dt * 6);
      rot += dt * SPEED[st];
      lvl += (levelRef.current() - lvl) * Math.min(1, dt * 14);

      const rgb = `${Math.round(col[0])},${Math.round(col[1])},${Math.round(col[2])}`;
      const breathe = 1 + Math.sin(t * 1.6) * 0.015 + lvl * 0.05;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.lineCap = "round";

      // ambient glow
      const glow = ctx.createRadialGradient(C, C, R * 0.1, C, C, R);
      glow.addColorStop(0, `rgba(${rgb},${0.24 + lvl * 0.28})`);
      glow.addColorStop(0.55, `rgba(${rgb},0.06)`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(C, C, R, 0, TAU);
      ctx.fill();

      // outer hairline + tick ring
      ctx.strokeStyle = `rgba(${rgb},0.28)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(C, C, R * 0.97, 0, TAU);
      ctx.stroke();
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(rot * 0.3);
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * TAU;
        const long = i % 5 === 0;
        ctx.strokeStyle = `rgba(${rgb},${long ? 0.75 : 0.3})`;
        ctx.lineWidth = long ? 2 : 1;
        const r1 = R * 0.93;
        const r2 = R * (long ? 0.86 : 0.895);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // glowing rings
      ctx.save();
      ctx.shadowColor = `rgba(${rgb},0.9)`;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = `rgba(${rgb},0.7)`;
      ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        const a0 = -rot * 0.6 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.arc(C, C, R * 0.8, a0, a0 + 1.25);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(${rgb},${0.35 + lvl * 0.45})`;
      ctx.lineWidth = 6;
      for (let i = 0; i < 24; i++) {
        const a0 = rot * 1.2 + (i / 24) * TAU;
        ctx.beginPath();
        ctx.arc(C, C, R * 0.67, a0, a0 + 0.16);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = `rgba(${rgb},0.2)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(C, C, R * 0.75, 0, TAU);
      ctx.stroke();

      // radar sweep while thinking / alerting
      if (st === "thinking" || st === "alert") {
        const sweep = rot * 1.5;
        ctx.lineWidth = 9;
        for (let i = 0; i < 26; i++) {
          const a1 = sweep - i * 0.04;
          ctx.strokeStyle = `rgba(${rgb},${(1 - i / 26) * 0.6})`;
          ctx.beginPath();
          ctx.arc(C, C, R * 0.72, a1 - 0.05, a1);
          ctx.stroke();
        }
      }

      // audio-reactive radial bars
      const N = 96;
      const inner = R * 0.5 * breathe;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU - Math.PI / 2;
        const noise = Math.abs(Math.sin(t * 3.1 + i * 0.55)) * Math.abs(Math.sin(t * 1.7 + i * 0.21 + 1.3));
        const idle = 0.04 + 0.025 * Math.sin(t * 1.2 + i * 0.3);
        const amp = idle + lvl * (0.35 + 0.65 * noise);
        const len = R * (0.02 + amp * 0.24);
        ctx.strokeStyle = `rgba(${rgb},${0.35 + Math.min(0.6, amp)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * inner, C + Math.sin(a) * inner);
        ctx.lineTo(C + Math.cos(a) * (inner + len), C + Math.sin(a) * (inner + len));
        ctx.stroke();
      }

      // reactor core
      ctx.save();
      ctx.shadowColor = `rgba(${rgb},1)`;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = `rgba(${rgb},0.9)`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(C, C, R * 0.44 * breathe, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(C, C, R * 0.34 * breathe, 0, TAU);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(-rot * 0.5);
      ctx.strokeStyle = `rgba(${rgb},0.85)`;
      ctx.lineWidth = 7;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.285 * breathe, a, a + 0.34);
        ctx.stroke();
      }
      ctx.restore();

      const core = ctx.createRadialGradient(C, C, 0, C, C, R * 0.26 * breathe);
      core.addColorStop(0, "rgba(255,255,255,0.98)");
      core.addColorStop(0.3, `rgba(${rgb},0.9)`);
      core.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(C, C, R * 0.26 * breathe, 0, TAU);
      ctx.fill();

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", aspectRatio: "1 / 1", display: "block" }} aria-hidden />;
}
