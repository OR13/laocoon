"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { RANGES } from "@/components/time-range";
import { Section } from "@/components/sections";
import { ScoreTrend } from "@/components/score-trend";
import type { ListedThread } from "@/lib/threads";
import dynamic from "next/dynamic";
import {
  contributorLevel, LEVEL_META, LEVELS, type NetworkEdge, type NetworkPerson, type DayRow, type NetworkThread, type NetworkTopic,
} from "@/lib/scores";
import { withBase } from "@/lib/base";

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
          Everyone who has posted to either list, every thread and every topic. Click
          anything to see what it is attached to.{" "}
          <a className="text-primary underline" href={withBase("/methodology/#scores")}>
            How the scores work
          </a>
          .
        </p>
        <ReplyNetwork
          people={people}
          edges={replies}
          threads={networkThreads}
          topics={networkTopics}
          height={660}
        />
      </Section>

      <Section id="ways-in" question="Where to start">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              href: "/lists/",
              title: "Mailing lists",
              body: "The two corpora, with their threads and their people under them.",
            },
            {
              href: "/people/",
              title: "People",
              body: "Everyone who has posted, and what they have published.",
            },
            {
              href: "/topics/",
              title: "Topics",
              body: "Clusters of threads about the same thing.",
            },
          ].map((card) => (
            <a
              key={card.href}
              href={card.href}
              className="hover:border-primary hover:bg-accent/40 rounded-lg border p-4 transition-colors"
            >
              <span className="block text-sm font-semibold">{card.title}</span>
              <span className="text-muted-foreground mt-1 block text-xs">{card.body}</span>
            </a>
          ))}
        </div>
      </Section>

      {daily.length > 0 && (
        <Section id="trend" question="Messages per day">
          <p className="text-muted-foreground mb-4 max-w-[80ch] text-sm">
            Left: the contributor score of whoever sent each message. Right: the utility
            score of the thread it landed in.
          </p>
          <ScoreTrend daily={daily} days={days} />
        </Section>
      )}
    </div>
  );
}
