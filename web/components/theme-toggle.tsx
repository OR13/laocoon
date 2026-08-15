"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "system", label: "System", Icon: Monitor },
  { id: "dark", label: "Dark", Icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // The server render cannot know the resolved theme, so nothing is marked
  // active until after hydration. Rendering a guess would flash the wrong one.
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Theme">
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => setTheme(id)}
          aria-pressed={mounted ? theme === id : undefined}
          title={label}
          className={cn(
            "px-2 py-1.5",
            mounted && theme === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
