import { cn } from "@/lib/utils";

/**
 * A ratio cell. Null renders as an explicit absence, never as 0 — an unmeasured
 * thread and a thread of hollow replies are different facts.
 */
export function RatioCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-muted-foreground text-xs italic">not measured</span>
    );
  }
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="bg-border relative h-[6px] w-12 overflow-hidden rounded-sm">
        <span
          className="bg-primary absolute inset-y-0 left-0"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tnum text-xs">{pct}%</span>
    </span>
  );
}

export function Num({ value, digits = 0, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className={cn("tnum", className)}>{digits ? value.toFixed(digits) : value}</span>;
}
