import { LEVEL_META, LEVELS, type Level } from "@/lib/scores";

/** `3 messages`, `1 message`. Written once because it kept being written wrong. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The pieces every profile page is built from.
 *
 * People, threads, topics and mailing lists are four views of the same data,
 * so they should look like four views of the same data. Sharing the stat tile,
 * the level bar and the level chip is what keeps them from drifting into four
 * dialects.
 */

/**
 * A stat is either a present value (a string), or an absence that carries its
 * own reason. A refusal is not a zero: a measure that declined to produce a
 * value must say the word and why, so the tile can never render a bare `0` that
 * reads as missing data. `as` is the word shown in place of the number.
 */
export type StatValue = string | { withheld: string; as: string };

export function Stats({ items }: { items: [string, StatValue][] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border p-3">
          <div className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</div>
          {typeof value === "string" ? (
            <div className="tnum mt-1 text-2xl font-semibold">{value}</div>
          ) : (
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-muted-foreground text-2xl font-semibold">{value.as}</span>
              <span
                tabIndex={0}
                title={value.withheld}
                aria-label={`${value.as}: ${value.withheld}`}
                className="text-muted-foreground/60 hover:text-muted-foreground focus:text-muted-foreground cursor-help text-sm leading-none"
              >
                &#9432;
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** A level as a coloured chip with its word. Colour is never alone. */
export function LevelChip({ level, prefix }: { level: Level; prefix?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        aria-hidden
        className="inline-block size-2.5 shrink-0 rounded-full"
        style={{ background: `var(${LEVEL_META[level].token})` }}
      />
      <span>
        {prefix ? `${prefix} ` : ""}
        {LEVEL_META[level].label.toLowerCase()}
      </span>
    </span>
  );
}

/** A distribution across the three levels, as one bar. */
export function LevelBar({
  counts,
  help,
}: {
  counts: Record<Level, number>;
  help?: Record<Level, string>;
}) {
  const total = LEVELS.reduce((n, l) => n + (counts[l] ?? 0), 0) || 1;
  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-md border">
        {LEVELS.filter((l) => (counts[l] ?? 0) > 0).map((l) => (
          <div
            key={l}
            title={help?.[l]}
            style={{
              width: `${((counts[l] ?? 0) / total) * 100}%`,
              background: `var(${LEVEL_META[l].token})`,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {LEVELS.map((l) => (
          <span key={l} className="flex items-center gap-1.5" title={help?.[l]}>
            <i
              className="inline-block size-2.5 rounded-[3px]"
              style={{ background: `var(${LEVEL_META[l].token})` }}
            />
            <span className="tnum text-foreground font-medium">{counts[l] ?? 0}</span>
            <span className="text-muted-foreground">{LEVEL_META[l].label.toLowerCase()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
