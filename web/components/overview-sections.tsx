"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { RANGES } from "@/components/time-range";
import { Section, ThreadList } from "@/components/sections";
import { ScoreTrend } from "@/components/score-trend";
import type { ListedThread } from "@/lib/threads";
import dynamic from "next/dynamic";
import {
  contributorLevel, LEVEL_META, LEVELS, type NetworkEdge, type NetworkPerson, type DayRow, type NetworkThread, type NetworkTopic,
} from "@/lib/scores";

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
  networkTopics,
  daily,
}: {
  threads: ListedThread[];
  activity: Activity | null;
  people: NetworkPerson[];
  replies: NetworkEdge[];
  networkThreads: NetworkThread[];
  networkTopics: NetworkTopic[];
  daily: DayRow[];
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
          each account&apos;s Laocoön contributor score — published RFCs, adopted drafts and
          roles on a 0-100 curve, and{" "}
          <a className="text-primary underline" href="/methodology/#scores">
            defined here
          </a>
          . Drag a node to pull it out of the pile.
        </p>
        <ReplyNetwork
          people={people}
          edges={replies}
          threads={networkThreads}
          topics={networkTopics}
          height={660}
        />
      </Section>

      <Section id="threads" question="Busiest threads">
        <p className="text-muted-foreground mb-4 max-w-[76ch] text-sm">
          The most active discussions in the window, with a link into the archive.
        </p>
        <ThreadList threads={busiest} empty="No threads in this window." limit={10} />
      </Section>

      {daily.length > 0 && (
        <Section id="trend" question="Messages per day, by both Laocoön scores">
          <p className="text-muted-foreground mb-4 max-w-[80ch] text-sm">
            One row per list, because agent2agent carries about twelve times the traffic and
            pooling them made the smaller list a rounding error. The left column is who sent
            each message — the sender&apos;s contributor score — and the right is what they
            sent into: the utility score of the thread it landed in.
          </p>
          <ScoreTrend daily={daily} days={days} />
        </Section>
      )}
    </div>
  );
}
