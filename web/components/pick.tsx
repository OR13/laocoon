"use client";

import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A typeahead multi-select.
 *
 * Hand-rolled rather than pulled in, because what it needs to do is small and
 * specific: filter a few hundred labels as you type, let several be chosen,
 * and show what is chosen as removable chips. A combobox library would bring
 * a popover, a portal and a focus trap for that.
 */
export interface PickOption {
  id: string;
  label: string;
  hint?: string;
}

export function Pick({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: PickOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const chosen = useMemo(
    () => selected.map((id) => options.find((o) => o.id === id)).filter((o): o is PickOption => !!o),
    [selected, options],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter((o) => !selected.includes(o.id) && o.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, options, selected]);

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground text-xs">{label}</span>
        {chosen.map((o) => (
          <span
            key={o.id}
            className="bg-accent flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
          >
            <span className="max-w-[14rem] truncate">{o.label}</span>
            <button
              type="button"
              aria-label={`Remove ${o.label}`}
              onClick={() => onChange(selected.filter((id) => id !== o.id))}
              className="hover:text-foreground text-muted-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Blur is deferred so a click on a suggestion lands before the list
          // is torn down.
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          className="bg-background h-7 min-w-[9rem] flex-1 rounded border px-2 text-xs"
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="bg-card absolute z-30 mt-1 max-h-60 w-full min-w-[18rem] overflow-auto rounded-md border shadow-lg">
          {matches.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, o.id]);
                  setQuery("");
                }}
                className={cn("hover:bg-accent block w-full px-2 py-1.5 text-left text-xs")}
              >
                <span className="block truncate">{o.label}</span>
                {o.hint && <span className="text-muted-foreground block text-[11px]">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
