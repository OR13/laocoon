"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The dashboard's lookback window.
 *
 * A week by default, because that is the horizon a chair is actually acting on
 * — what has the list done since I last looked. Everything on the page reads
 * this, including the period-over-period deltas, which compare the window with
 * the equally long window immediately before it.
 */
export const RANGES = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
  { days: 0, label: "All" },
] as const;

/**
 * Default 0 — all time — because that is what a component rendered *outside* a
 * provider should show. The dashboard's provider sets 7 explicitly; a consumer
 * with no provider above it must not inherit a window nobody chose.
 */
const Ctx = createContext<{ days: number; setDays: (d: number) => void }>({
  days: 0,
  setDays: () => {},
});

export function TimeRangeProvider({ children }: { children: React.ReactNode }) {
  const [days, setDays] = useState(7);
  const value = useMemo(() => ({ days, setDays }), [days]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTimeRange = () => useContext(Ctx);

export function TimeRangePicker() {
  const { days, setDays } = useTimeRange();
  return (
    <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Lookback window">
      {RANGES.map((r) => (
        <button
          key={r.days}
          onClick={() => setDays(r.days)}
          aria-pressed={days === r.days}
          className={cn(
            "px-3 py-1.5 text-xs",
            days === r.days
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** Split a daily series into the current window and the one before it. */
export function splitWindow<T extends { day: string }>(rows: T[], days: number) {
  if (days <= 0 || rows.length === 0) return { current: rows, previous: [] as T[] };
  const current = rows.slice(-days);
  const previous = rows.slice(Math.max(0, rows.length - days * 2), rows.length - days);
  return { current, previous };
}
