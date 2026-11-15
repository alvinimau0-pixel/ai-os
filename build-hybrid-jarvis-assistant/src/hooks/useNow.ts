"use client";

import { useEffect, useState } from "react";

/** Current time in ms, ticking every `interval` ms. `null` until mounted (avoids hydration mismatches). */
export function useNow(interval = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick);
    const id = window.setInterval(tick, interval);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, [interval]);
  return now;
}
