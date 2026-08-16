"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { LevelChip } from "@/components/entity";
import { contributorLevel, LEVEL_META, LEVELS, type Level, type NetworkPerson } from "@/lib/scores";

/** Everyone, searchable and sortable. 204 rows needs a filter, not a scroll. */
export function PeopleIndex({ people }: { people: NetworkPerson[] }) {
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Level[]>([...LEVELS]);
  const [sort, setSort] = useState<"messages" | "score">("messages");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => levels.includes(contributorLevel(p.score)))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === "score" ? b.score - a.score || b.messages - a.messages : b.messages - a.messages,
      );
  }, [people, query, levels, sort]);

  return (
    <div>
      <div className="bg-card mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <Input
          className="h-8 w-56 text-xs"
          placeholder="Find someone…"
          aria-label="Find someone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Contributor score">
          {LEVELS.map((l) => (
            <button
              key={l}
              aria-pressed={levels.includes(l)}
              onClick={() =>
                setLevels((c) => (c.includes(l) ? c.filter((x) => x !== l) : [...c, l]))
              }
              className={
                levels.includes(l)
                  ? "px-3 py-1.5 text-xs text-white"
                  : "text-muted-foreground hover:bg-accent px-3 py-1.5 text-xs"
              }
              style={levels.includes(l) ? { background: `var(${LEVEL_META[l].token})` } : undefined}
            >
              {LEVEL_META[l].label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setSort(sort === "messages" ? "score" : "messages")}
          className="text-muted-foreground hover:bg-accent rounded-md border px-3 py-1.5 text-xs"
        >
          Sorted by {sort === "messages" ? "messages" : "contributor score"}
        </button>
        <span className="text-muted-foreground ml-auto text-xs">
          {rows.length} of {people.length}
        </span>
      </div>
      <ul className="divide-y">
        {rows.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
            <LevelChip level={contributorLevel(p.score)} />
            <a className="hover:text-primary hover:underline" href={`/people/${p.id}/`}>
              {p.name}
            </a>
            <span className="text-muted-foreground tnum ml-auto text-xs">
              {p.messages} messages · contributor {p.score} · {p.rfcs} RFC
              {p.rfcs === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
