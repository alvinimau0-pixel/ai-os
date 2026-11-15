import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  icon: LucideIcon;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, icon: Icon, right, children, className = "", bodyClassName = "" }: Props) {
  return (
    <section className={`hud-panel flex min-h-0 flex-col ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-mute">
          <Icon className="size-3.5" strokeWidth={2} />
          <h2 className="hud-label m-0">{title}</h2>
        </div>
        {right}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-20 flex-col items-center justify-center gap-2 px-4 py-6 text-center text-xs text-mute">
      <Icon className="size-5 opacity-60" strokeWidth={1.5} />
      <p className="m-0 max-w-[24ch] leading-relaxed">{children}</p>
    </div>
  );
}
