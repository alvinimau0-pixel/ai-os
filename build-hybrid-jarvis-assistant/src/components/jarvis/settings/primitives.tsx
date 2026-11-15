"use client";

import { useState, type ReactNode } from "react";

export function Section({ title, icon, id, children }: { title: string; icon: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-14 border-b border-white/[0.06] px-4 py-4">
      <h3 className="hud-label m-0 mb-3 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink/90">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-mute">{hint}</span>}
    </label>
  );
}

export function TextField({ value, onCommit, placeholder, maxLength = 60 }: { value: string; onCommit: (v: string) => void; placeholder?: string; maxLength?: number }) {
  const [v, setV] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setV(value);
  }
  const commit = () => {
    if (v.trim() !== value) onCommit(v.trim());
  };
  return (
    <input
      className="hud-input"
      value={v}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-active={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className="hud-btn px-2 py-2"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[12px] font-medium text-ink/90">{label}</div>
        {hint && <div className="text-[11px] leading-snug text-mute">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition ${checked ? "border-arc/70 bg-arc/25" : "border-white/15 bg-white/[0.06]"}`}
      >
        <span className={`absolute top-0.5 size-4.5 rounded-full bg-arc transition-all ${checked ? "left-[22px]" : "left-0.5 opacity-60"}`} />
      </button>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onCommit,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  format: (v: number) => string;
}) {
  const [v, setV] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setV(value);
  }
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-[12px] font-medium text-ink/90">
        {label}
        <span className="font-hud text-[11px] text-arc">{format(v)}</span>
      </span>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => onCommit(v)}
        onKeyUp={() => onCommit(v)}
        onBlur={() => v !== value && onCommit(v)}
      />
    </label>
  );
}
