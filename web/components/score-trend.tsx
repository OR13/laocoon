"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LEVEL_META, LEVELS, type DayRow, type Level } from "@/lib/scores";

/**
 * Messages per day, as small multiples: one row per list, one column per score.
 *
 * **Per list, because pooling hid the difference.** agent2agent carries twelve
 * times the traffic of agentproto, and a single stacked chart is a chart of
 * agent2agent with a rounding error on top.
 *
 * **Two columns, because the two scores answer different questions.** Who is
 * sending — the sender's Laocoön contributor score — and what they are sending
 * into — the Laocoön utility score of the thread the message landed in. Same
 * unit in every band of every panel, so heights are the day's traffic and the
 * composition is the reading. Never a second axis.
 */
export function ScoreTrend({ daily, days }: { daily: DayRow[]; days: number }) {
  const lists = useMemo(
    () => [...new Set(daily.map((d) => d.list_name))].filter(Boolean).sort(),
    [daily],
  );

  const windowed = useMemo(() => {
    if (days <= 0) return daily;
    const allDays = [...new Set(daily.map((d) => d.day))].sort();
    const keep = new Set(allDays.slice(-days));
    return daily.filter((d) => keep.has(d.day));
  }, [daily, days]);

  // One shared y-scale per column, so the two lists are comparable rather than
  // each filling its own panel and looking equally busy.
  const peak = useMemo(() => {
    const totals = (key: "contributor" | "utility") =>
      windowed.map((d) => LEVELS.reduce((n, l) => n + (d[key][l] ?? 0), 0));
    return {
      contributor: Math.max(1, ...totals("contributor")),
      utility: Math.max(1, ...totals("utility")),
    };
  }, [windowed]);

  const panel = (list: string, key: "contributor" | "utility") => {
    const rows = windowed
      .filter((d) => d.list_name === list)
      .map((d) => ({ day: d.day.slice(5), ...d[key] }));
    return (
      <div key={`${list}-${key}`}>
        <p className="text-muted-foreground mb-1 text-xs">
          <span className="text-foreground font-medium">{list}</span> ·{" "}
          {key === "contributor" ? "who sent it" : "what they sent into"}
        </p>
        <div className="h-[150px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ left: 0, right: 6, top: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={6} minTickGap={36} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={26}
                allowDecimals={false}
                domain={[0, peak[key]]}
              />
              <Tooltip />
              {/* Low at the bottom: it is the biggest band and a stack reads
                  from the axis up, so the band that moves least sits nearest it. */}
              {(["low", "medium", "high"] as Level[]).map((l) => (
                <Area
                  key={l}
                  dataKey={l}
                  stackId="messages"
                  type="monotone"
                  strokeWidth={1}
                  isAnimationActive={false}
                  stroke={`var(${LEVEL_META[l].token})`}
                  fill={`var(${LEVEL_META[l].token})`}
                  fillOpacity={0.85}
                  name={`${LEVEL_META[l].label} ${key === "contributor" ? "contributor" : "utility"}`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  if (lists.length === 0) return null;

  return (
    <div>
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
        {lists.flatMap((list) => [panel(list, "contributor"), panel(list, "utility")])}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        {LEVELS.map((l) => (
          <span key={l} className="flex items-center gap-1.5">
            <i
              className="inline-block size-2.5 rounded-[3px]"
              style={{ background: `var(${LEVEL_META[l].token})` }}
            />
            <span className="text-muted-foreground">{LEVEL_META[l].label}</span>
          </span>
        ))}
        <span className="text-muted-foreground ml-auto">
          left column is the sender&apos;s contributor score, right is the thread&apos;s utility
          score · both columns share a y-scale across the lists
        </span>
      </div>
    </div>
  );
}
