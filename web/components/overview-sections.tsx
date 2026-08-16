"use client";

import { useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { RANGES } from "@/components/time-range";
import { Headline, Section, SplitBar, ThreadList } from "@/components/sections";
import {
  ENGAGEMENT_META, ENGAGEMENT_ORDER, engagementOf, type MapThread,
} from "@/components/thread-map";
import dynamic from "next/dynamic";
import type { NetworkEdge, NetworkPerson } from "@/components/reply-network";

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
function inWindow(threads: MapThread[], days: number): MapThread[] {
  if (days <= 0) return threads;
  const newest = threads.reduce(
    (latest, t) => (t.last_message_at && t.last_message_at > latest ? t.last_message_at : latest),
    "",
  );
  if (!newest) return threads;
  const cutoff = new Date(Date.parse(newest) - days * 86_400_000).toISOString();
  return threads.filter((t) => (t.last_message_at ?? "") >= cutoff);
}

/** A newcomer's first message that drew a standing reply, link already built. */
export interface NewcomerWin {
  message_id: string;
  list_name: string;
  gist: string;
  sent_at: string | null;
  replies_from_standing: number;
  thread_messages: number;
  href: string;
}

export function OverviewSections({
  threads,
  activity,
  newcomerWins,
  people,
  replies,
}: {
  threads: MapThread[];
  activity: Activity | null;
  newcomerWins: NewcomerWin[];
  people: NetworkPerson[];
  replies: NetworkEdge[];
}) {
  const [days, setDays] = useState(30);
  const [list, setList] = useState("all");

  const lists = useMemo(() => [...new Set(threads.map((t) => t.list_name))].sort(), [threads]);

  const visible = useMemo(() => {
    const windowed = inWindow(threads, days);
    return list === "all" ? windowed : windowed.filter((t) => t.list_name === list);
  }, [threads, days, list]);

  const byState = useMemo(() => {
    const out = { answering: [] as MapThread[], present: [] as MapThread[], none: [] as MapThread[] };
    for (const t of visible) out[engagementOf(t)].push(t);
    return out;
  }, [visible]);

  const unanswered = useMemo(
    () => [...byState.none].sort((a, b) => b.messages - a.messages || b.participants - a.participants),
    [byState.none],
  );
  const answered = useMemo(
    () => [...byState.answering].sort((a, b) => b.messages - a.messages),
    [byState.answering],
  );

  const messagesIn = (rows: MapThread[]) => rows.reduce((n, t) => n + t.messages, 0);
  const totalMessages = messagesIn(visible);
  const unansweredMessages = messagesIn(byState.none);
  const sharePct = totalMessages ? Math.round((unansweredMessages / totalMessages) * 100) : 0;

  const newcomers = useMemo(
    () =>
      newcomerWins
        .filter((m) => list === "all" || m.list_name === list)
        .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))
        .slice(0, 6),
    [newcomerWins, list],
  );

  const trend = useMemo(() => {
    if (!activity) return [];
    const rows = days > 0 ? activity.daily.slice(-days) : activity.daily;
    // Both series are counts of people. Messages and people on one axis put
    // the series that matters flat along the bottom, and a second axis is
    // never the answer to that.
    return rows.map((d) => ({
      day: d.day.slice(5),
      participants: d.participants,
      with_standing: d.participants_with_standing,
    }));
  }, [activity, days]);

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

      <Section id="share" question="How much of this went unanswered by anyone established?">
        <Headline
          value={`${sharePct}%`}
          caption={
            <>
              of the {totalMessages} messages in view are in threads where{" "}
              <strong>nobody holding community-conferred standing took part at all</strong> —{" "}
              {byState.none.length} of {visible.length} threads. That is a fact about who posted,
              not a judgement of the discussion: a thread of people the chairs simply did not
              read looks the same.
            </>
          }
        />
        <div className="mt-6">
          <SplitBar
            parts={ENGAGEMENT_ORDER.map((state) => ({
              label: ENGAGEMENT_META[state].label,
              value: byState[state].length,
              token: ENGAGEMENT_META[state].token,
              help: ENGAGEMENT_META[state].help,
            }))}
          />
        </div>
      </Section>

      <Section id="network" question="Who is talking to whom">
        <p className="text-muted-foreground mb-4 max-w-[76ch] text-sm">
          Everyone who has posted to either list, joined by who answered whom. People who
          reply to each other are drawn near each other, so a cluster is a conversation and
          the space between clusters is the absence of one.
        </p>
        <ReplyNetwork people={people} edges={replies} />
      </Section>

      <Section id="unanswered" question="What drew the most traffic without them?">
        <ThreadList
          threads={unanswered}
          empty="Every thread in this window had a participant with standing."
          state={() => "none"}
        />
      </Section>

      <Section id="answered" question="What did they turn up for?">
        <ThreadList
          threads={answered}
          empty="No thread in this window drew a reply from an account with standing."
          state={engagementOf}
        />
      </Section>

      {newcomers.length > 0 && (
        <Section id="newcomers" question="Who got it right on their first try?">
          <p className="text-muted-foreground mb-3 max-w-[70ch] text-sm">
            A participant&apos;s first message that drew a reply from someone with standing.
            Worked examples, and the most useful thing to show a newcomer.
          </p>
          <ul className="divide-y">
            {newcomers.map((m) => (
              <li key={m.message_id} className="py-2.5">
                <a
                  href={m.href}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary text-sm hover:underline"
                >
                  {m.gist?.trim() || m.message_id.slice(0, 60)}
                  {m.gist && !/[.!?:]$/.test(m.gist.trim()) ? "…" : ""} ↗
                </a>
                <div className="text-muted-foreground tnum mt-0.5 text-xs">
                  {m.sent_at?.slice(0, 10) ?? "—"} · {m.replies_from_standing} repl
                  {m.replies_from_standing === 1 ? "y" : "ies"} from standing · thread of{" "}
                  {m.thread_messages}
                  <span className="ml-1.5 tracking-wide uppercase opacity-70">{m.list_name}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {trend.length > 1 && (
        <Section id="trend" question="Is it getting better or worse?">
          <p className="text-muted-foreground mb-4 max-w-[74ch] text-sm">
            People posting each day, and how many of them hold community-conferred standing.
            Both are counts of people, so the gap between the lines is the reading.
          </p>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 4, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip />
                <Area
                  dataKey="participants" type="monotone" strokeWidth={2} isAnimationActive={false}
                  stroke="var(--eng-none)" fill="var(--eng-none)" fillOpacity={0.15}
                  name="People posting"
                />
                <Area
                  dataKey="with_standing" type="monotone" strokeWidth={2} isAnimationActive={false}
                  stroke="var(--eng-answering)" fill="var(--eng-answering)" fillOpacity={0.2}
                  name="…with standing"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
    </div>
  );
}
