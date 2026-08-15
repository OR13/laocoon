"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent,
} from "@/components/ui/chart";
import { TimeRangePicker, splitWindow, useTimeRange } from "@/components/time-range";
import { cn } from "@/lib/utils";
import type { Activity, DailyRow } from "@/lib/data";

/**
 * The executive summary.
 *
 * Ordered by what a chair is actually asking: how busy was the list, who was in
 * it, did people with standing show up, and is any of that changing. Deltas
 * compare the selected window with the equally long window before it, which is
 * the only comparison that does not need a baseline nobody agreed on.
 *
 * There is still no composite score. Every tile is one measured quantity, and
 * the charts never share a y-axis between quantities of different scale.
 */

const sum = (rows: DailyRow[], key: keyof DailyRow) =>
  rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);

function pctChange(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return (now - before) / before;
}

function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) {
    return <span className="text-muted-foreground text-xs">no prior period</span>;
  }
  const flat = Math.abs(value) < 0.005;
  const up = value > 0;
  const good = invert ? !up : up;
  const Icon = flat ? ArrowRight : up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        flat ? "text-muted-foreground" : good ? "text-[var(--good)]" : "text-[var(--bad)]",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {flat ? "flat" : `${up ? "+" : ""}${Math.round(value * 100)}%`}
      <span className="text-muted-foreground">vs prior</span>
    </span>
  );
}

function Tile({
  label, value, delta, invert, note,
}: {
  label: string;
  value: string | number;
  delta?: number | null;
  invert?: boolean;
  note?: string;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="tnum text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-0.5">
          {delta !== undefined && <Delta value={delta} invert={invert} />}
          {note && <span className="text-muted-foreground text-xs">{note}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

const volumeConfig = {
  messages: { label: "Messages", color: "var(--chart-messages)" },
  replies: { label: "Replies", color: "var(--chart-replies)" },
} satisfies ChartConfig;

const peopleConfig = {
  participants: { label: "Participants", color: "var(--chart-messages)" },
  participants_with_standing: { label: "With standing", color: "var(--chart-standing)" },
  new_participants: { label: "New", color: "var(--chart-new)" },
} satisfies ChartConfig;

export function Dashboard({ activity }: { activity: Activity }) {
  // Combined across every crawled list, with the per-list split available so a
  // number is never silently one list standing in for all of them.
  const { days } = useTimeRange();
  const { current, previous } = useMemo(
    () => splitWindow(activity.daily, days),
    [activity.daily, days],
  );

  const stats = useMemo(() => {
    const uniq = (rows: DailyRow[], key: keyof DailyRow) =>
      Math.max(0, ...rows.map((r) => Number(r[key]) || 0));
    return {
      messages: sum(current, "messages"),
      messagesPrev: sum(previous, "messages"),
      threads: uniq(current, "threads_touched"),
      threadsPrev: uniq(previous, "threads_touched"),
      people: uniq(current, "participants"),
      peoplePrev: uniq(previous, "participants"),
      standing: sum(current, "participants_with_standing"),
      standingPrev: sum(previous, "participants_with_standing"),
      newcomers: sum(current, "new_participants"),
      newcomersPrev: sum(previous, "new_participants"),
      replies: sum(current, "replies"),
      repliesPrev: sum(previous, "replies"),
    };
  }, [current, previous]);

  const rangeLabel = days > 0 ? `last ${days} days` : "the whole corpus";
  const from = current[0]?.day ?? "—";
  const to = current[current.length - 1]?.day ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          <strong className="text-foreground">{activity.lists.join(" + ")}</strong> —{" "}
          <strong className="text-foreground">{rangeLabel}</strong>
          {current.length > 0 && <> — {from} to {to}</>}. Deltas compare with the
          equally long window immediately before.
        </p>
        <TimeRangePicker />
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-4 text-xs" data-review="cross-list">
        {activity.lists.map((name) => {
          const l = activity.per_list[name];
          const rows = splitWindow(l?.daily ?? [], days).current;
          return (
            <span key={name} className="rounded-md border px-2 py-1">
              <strong className="text-foreground">{name}</strong>{" "}
              {sum(rows, "messages")} msgs in window · {l?.messages ?? 0} total ·{" "}
              {l?.senders ?? 0} senders
            </span>
          );
        })}
        <span className="rounded-md border px-2 py-1">
          <strong className="text-foreground">{activity.cross_list.on_more_than_one_list}</strong>{" "}
          of {activity.cross_list.distinct_people} people post on more than one list
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Messages" value={stats.messages} delta={pctChange(stats.messages, stats.messagesPrev)} />
        <Tile label="Replies" value={stats.replies} delta={pctChange(stats.replies, stats.repliesPrev)} />
        <Tile label="Threads touched" value={stats.threads} delta={pctChange(stats.threads, stats.threadsPrev)} note="" />
        <Tile label="Peak participants/day" value={stats.people} delta={pctChange(stats.people, stats.peoplePrev)} />
        <Tile
          label="Participation with standing"
          value={stats.standing}
          delta={pctChange(stats.standing, stats.standingPrev)}
        />
        <Tile
          label="New participants"
          value={stats.newcomers}
          delta={pctChange(stats.newcomers, stats.newcomersPrev)}
          invert={false}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-review="volume">
          <CardHeader>
            <CardTitle className="text-base">Volume — all lists</CardTitle>
            <CardDescription>
              Messages and replies per day, summed across {activity.lists.length} lists.
              Volume is the thing this project treats with suspicion, not the thing it
              rewards — on the larger list it is also the best predictor of what happens
              next, which nothing model-derived has yet beaten.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={volumeConfig} className="h-[220px] w-full">
              <AreaChart data={current} margin={{ left: 4, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="day" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v: string) => v.slice(5)} minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                {/* Animation off: this is a static dashboard, and an animated
                    mount means a screenshot or a print catches an empty chart. */}
                <Area
                  dataKey="messages" type="monotone" strokeWidth={2} isAnimationActive={false}
                  stroke="var(--color-messages)" fill="var(--color-messages)" fillOpacity={0.12}
                />
                <Area
                  dataKey="replies" type="monotone" strokeWidth={2} isAnimationActive={false}
                  stroke="var(--color-replies)" fill="var(--color-replies)" fillOpacity={0.1}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who showed up</CardTitle>
            <CardDescription>
              Distinct participants per day, and how many held community-conferred
              standing. Counts, never names.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={peopleConfig} className="h-[220px] w-full">
              <LineChart data={current} margin={{ left: 4, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="day" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v: string) => v.slice(5)} minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line dataKey="participants" type="monotone" strokeWidth={2} dot={false} isAnimationActive={false} stroke="var(--color-participants)" />
                <Line dataKey="participants_with_standing" type="monotone" strokeWidth={2} dot={false} isAnimationActive={false} stroke="var(--color-participants_with_standing)" />
                <Line dataKey="new_participants" type="monotone" strokeWidth={2} dot={false} isAnimationActive={false} stroke="var(--color-new_participants)" strokeDasharray="4 3" />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
