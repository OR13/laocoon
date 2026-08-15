"use client";

/**
 * The design-review panel.
 *
 * A build is not finished when it compiles; it is finished when the person who
 * asked for it has looked at it and said what is wrong. This panel is that step
 * made part of the app: it states what changed, points at the specific things to
 * look at, and carries the question being asked about each one.
 *
 * It is driven by `review.json`, which is committed alongside the change it
 * describes — so the review notes and the code they describe cannot drift.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ClipboardCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReviewFocus {
  id: string;
  target: string;
  title: string;
  ask: string;
  watch?: string;
}

export interface ReviewSpec {
  cycle: string;
  pending: boolean;
  title: string;
  summary: string;
  focus: ReviewFocus[];
}

export function ReviewPanel({ spec }: { spec: ReviewSpec }) {
  const [open, setOpen] = useState(spec.pending);
  const [active, setActive] = useState<string | null>(null);

  const focusOn = useCallback((item: ReviewFocus) => {
    setActive(item.id);
    const el = document.querySelector(item.target);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // A ring rather than a colour change: the section keeps its own palette, and
    // the highlight has to survive both themes.
    el.classList.add("review-target");
    window.setTimeout(() => el.classList.remove("review-target"), 2600);
  }, []);

  // Shift the page rather than overlaying it. A review panel that covers the
  // thing under review is worse than no panel.
  useEffect(() => {
    document.body.classList.toggle("review-open", open);
    return () => document.body.classList.remove("review-open");
  }, [open]);

  // Escape closes, so the panel never traps the reader.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-primary text-primary-foreground fixed top-1/2 right-0 z-50 flex -translate-y-1/2 items-center gap-1.5 rounded-l-lg px-2 py-3 text-xs shadow-lg"
        aria-label="Open the design review panel"
      >
        <ClipboardCheck className="size-4" aria-hidden />
        <span className="[writing-mode:vertical-rl]">Review</span>
      </button>
    );
  }

  return (
    <aside
      className="bg-card fixed top-0 right-0 z-50 flex h-full w-[22rem] flex-col border-l shadow-2xl"
      aria-label="Design review"
    >
      <header className="flex items-start justify-between gap-2 border-b p-4">
        <div>
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-wide uppercase">
            <ClipboardCheck className="size-3.5" aria-hidden /> Design review
          </div>
          <h2 className="mt-1 text-sm leading-snug font-semibold">{spec.title}</h2>
          <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">{spec.cycle}</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="hover:bg-accent rounded p-1"
          aria-label="Close the design review panel"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4 text-sm">
        <p className="text-muted-foreground leading-snug">{spec.summary}</p>

        <ol className="mt-4 space-y-2">
          {spec.focus.map((item, index) => (
            <li key={item.id}>
              <button
                onClick={() => focusOn(item)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  active === item.id ? "border-primary bg-accent" : "hover:bg-accent/60",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="bg-muted text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 text-[13px] font-semibold">
                      {item.title}
                      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-snug">{item.ask}</p>
                    {item.watch && (
                      <p className="text-muted-foreground/80 mt-1 text-[11px] italic">
                        {item.watch}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <footer className="text-muted-foreground border-t p-3 text-[11px] leading-snug">
        Click an item to scroll to it and highlight it. Escape closes the panel; the
        tab on the right brings it back.
      </footer>
    </aside>
  );
}
