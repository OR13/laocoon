"use client";

import { useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { RANGES } from "@/components/time-range";
import { Headline, Section, SplitBar, ThreadList } from "@/components/sections";
import type { ListedThread } from "@/lib/threads";
import dynamic from "next/dynamic";
import {
  BAND_META, BAND_ORDER, type NetworkEdge, type NetworkPerson, type NetworkThread,
} from "@/lib/record-bands";

// sigma reads WebGL2RenderingContext at import time, absent during prerender.
const ReplyNetwork = dynamic(
  () => import("@/components/reply-network").then((m) => m.ReplyNetwork),
  {
    ssr: false,
    loading: () => (
      <div className="bg-card text-muted-foreground flex h-[620px] w-full items-center justify-center rounded-lg border text-xs">
        Drawing the network…
      </div>
    ),
  },
);
import type { Activity } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * The overview, as a sequence of questions.
 *
 * What was here was nine cards of equal weight — three of them tables, one a
 * 7×3 grid of Cliff's deltas — and the reading it produced was "there is a lot
 * here", not an answer to anything. The operator's question is one sentence:
 * which discussions are on-topic exchanges that serious people engaged with,
 * and which are traffic nobody with standing ever answered.
 *
 * So each section is one question with one number and one visual, and anything
 * that needed a table now lives on the page built for scanning columns.
 */

/** Threads whose last message falls inside the lookback window. */
function inWindow(threads: ListedThread[], days: number): ListedThread[] {
  if (days <= 0) return threads;
  const newest = threads.reduce(
    (latest, t) => (t.last_message_at && t.last_message_at > latest ? t.last_message_at : latest),
    "",
  );
  if (!newest) return threads;
  const cutoff = new Date(Date.parse(newest) - days * 86_400_000).toISOString();
  return threads.filter((t) => (t.last_message_at ?? "") >= cutoff);
}

export function OverviewSections({
  threads,
  activity,
  people,
  replies,
  networkThreads,
  daily,
}: {
  threads: ListedThread[];
  activity: Activity | null;
  people: NetworkPerson[];
  replies: NetworkEdge[];
  networkThreads: NetworkThread[];
  daily: { day: string; extensive: number; established: number; some: number; none: number }[];
}) {
  const [days, setDays] = useState(30);
  const [list, setList] = useState("all");

  const lists = useMemo(() => [...new Set(threads.map((t) => t.list_name))].sort(), [threads]);

  const visible = useMemo(() => {
    const windowed = inWindow(threads, days);
    return list === "all" ? windowed : windowed.filter((t) => t.list_name === list);
  }, [threads, days, list]);

  const busiest = useMemo(
    () => [...visible].sort((a, b) => b.messages - a.messages || b.participants - a.participants),
    [visible],
  );

  const totalMessages = visible.reduce((n, t) => n + t.messages, 0);

  // Messages per day by the sender's publication record. Same unit in every
  // band, so the bands stack and the total is the day's traffic.
  const trend = useMemo(() => {
    const rows = days > 0 ? daily.slice(-days) : daily;
    return rows.map((d) => ({ ...d, day: d.day.slice(5) }));
  }, [daily, days]);

  return (
    <div className="pb-16">
      {/* One control bar for the whole page, so a reader sets the window once. */}
      <div className="bg-background/95 sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-b px-1 py-3 backdrop-blur">
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
        <div className="flex items-center gap-1" role="group" aria-label="Filter by list">
          <Button size="sm" variant={list === "all" ? "default" : "outline"} onClick={() => setList("all")}>
            Both lists
          </Button>
          {lists.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={list === name ? "default" : "outline"}
              onClick={() => setList(name)}
            >
              {name}
            </Button>
          ))}
        </div>
        <span className="text-muted-foreground ml-auto text-xs">
          {visible.length} threads · {totalMessages} messages
        </span>
      </div>

      <Section id="network" question="Who is talking to whom">
        <p className="text-muted-foreground mb-4 max-w-[76ch] text-sm">
          Everyone who has posted to either list, joined by who answered whom. Colour is
          each account&apos;s published IETF record — RFCs, adopted drafts and roles, scored
          out of 100 and{" "}
          <a className="text-primary underline" href="/methodology/#record-score">
            defined here
          </a>
          . Drag a node to pull it out of the pile.
        </p>
        <ReplyNetwork people={people} edges={replies} threads={networkThreads} height={640} />
      </Section>

      <Section id="threads" question="Busiest threads">
        <p className="text-muted-foreground mb-4 max-w-[76ch] text-sm">
          The most active discussions in the window, with a link into the archive.
        </p>
        <ThreadList threads={busiest} empty="No threads in this window." limit={10} />
      </Section>

      {trend.length > 1 && (
        <Section id="trend" question="Messages per day, by the sender's published record">
          <p className="text-muted-foreground mb-4 max-w-[76ch] text-sm">
            Every message in the window, stacked by how much its sender has published in
            the IETF. The bands share one unit, so the height is the day&apos;s traffic and
            the composition is who produced it.
          </p>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 4, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip />
                <Legend />
                {BAND_ORDER.slice().reverse().map((b) => (
                  <Area
                    key={b}
                    dataKey={b}
                    stackId="messages"
                    type="monotone"
                    strokeWidth={1}
                    isAnimationActive={false}
                    stroke={`var(${BAND_META[b].token})`}
                    fill={`var(${BAND_META[b].token})`}
                    fillOpacity={0.85}
                    name={`${BAND_META[b].label} published record`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
    </div>
  );
}
