"use client";

/**
 * Every thread, as something you can actually look through.
 *
 * The page this replaces rendered all 392 threads as one table: 19,300 pixels
 * of scroll, no search, no sort, no filter, and no way to reach the message it
 * was describing. Every fact was on the page and none of them were findable,
 * which is the same failure as a graph that draws every node — the constraint
 * is the reader, not the medium.
 *
 * **Sorting is the reader's, and the default is not a ranking.** The page
 * opens on message count, which is a fact about size rather than an opinion
 * about worth, and no column is ranked for you. That is the same reason
 * PROBLEM.md section 7 refuses a composite score: order implies judgement, so
 * the judgement has to be an action the reader took.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Num, RatioCell } from "@/components/measure-cell";
import { cn } from "@/lib/utils";
import { tidySubject } from "@/lib/graph-model";
import type { ThreadLanguage, ThreadMeasure } from "@/lib/data";

const PAGE = 40;

interface Row extends ThreadMeasure {
  median_distinctiveness: number | null;
  share_offering_nothing_checkable: number | null;
  /** Built on the server: `lib/archive` hashes with node:crypto. */
  href: string;
}

/** One row's archive link, computed server-side and handed in. */
export interface ThreadHref {
  thread_id: string;
  href: string;
}

type SortKey =
  | "messages_total"
  | "distinct_senders"
  | "max_depth"
  | "seeded_participants"
  | "median_novelty"
  | "median_distinctiveness"
  | "share_offering_nothing_checkable"
  | "last";

/** Column definitions, so header, cell and sort key cannot drift apart. */
const COLUMNS: {
  key: SortKey;
  label: string;
  help: string;
  render: (r: Row) => React.ReactNode;
}[] = [
  {
    key: "messages_total",
    label: "Messages",
    help: "Messages in the thread.",
    render: (r) => <Num value={r.messages_total} />,
  },
  {
    key: "distinct_senders",
    label: "People",
    help: "Distinct participants. A count, never a list.",
    render: (r) => <Num value={r.distinct_senders} />,
  },
  {
    key: "max_depth",
    label: "Depth",
    help: "Longest chain of replies, from the opening message to the deepest answer.",
    render: (r) => <Num value={r.max_depth} />,
  },
  {
    key: "seeded_participants",
    label: "With standing",
    help:
      "Participants holding community-conferred standing under the published seed rule. " +
      "A count, and not a judgement of anyone's contribution.",
    render: (r) => <Num value={r.seeded_participants} />,
  },
  {
    key: "median_novelty",
    label: "Novelty",
    help:
      "Median share of a reply's sentences that said something the thread had not " +
      "already said. High novelty is not the same as substance — fluent filler scores high.",
    render: (r) => <RatioCell value={r.median_novelty} />,
  },
  {
    key: "median_distinctiveness",
    label: "Belongs here",
    help:
      "How much more this thread's messages resemble each other than they resemble the " +
      "rest of the list. Near zero means they would read as sensibly in another thread.",
    render: (r) => <Distinct value={r.median_distinctiveness} />,
  },
  {
    key: "share_offering_nothing_checkable",
    label: "Nothing to check",
    help:
      "Share of messages over 40 words that cite nothing, contest nothing and ask nothing. " +
      "Says what a message offers the discussion, never who wrote it or how.",
    render: (r) => <RatioCell value={r.share_offering_nothing_checkable} />,
  },
];

/**
 * Distinctiveness runs either side of zero, so it gets a centred bar rather
 * than a percentage: the sign is the reading, and a negative percentage bar
 * would be nonsense.
 */
function Distinct({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground text-xs italic">not measured</span>;
  }
  const clamped = Math.max(-0.25, Math.min(0.5, value));
  const width = Math.abs(clamped) / 0.5;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="bg-border relative h-[6px] w-14 overflow-hidden rounded-sm">
        <span className="bg-muted-foreground/40 absolute inset-y-0 left-1/3 w-px" />
        <span
          className={cn("absolute inset-y-0", clamped < 0 ? "bg-[var(--warn)]" : "bg-primary")}
          style={
            clamped < 0
              ? { right: "66.66%", width: `${width * 33}%` }
              : { left: "33.33%", width: `${width * 66}%` }
          }
        />
      </span>
      <span className="tnum text-xs">{value.toFixed(2)}</span>
    </span>
  );
}

export function ThreadTable({
  measures,
  language,
  hrefs,
}: {
  measures: ThreadMeasure[];
  language: ThreadLanguage[];
  hrefs: ThreadHref[];
}) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("messages_total");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);

  const lists = useMemo(
    () => [...new Set(measures.map((m) => m.list_name))].sort(),
    [measures],
  );

  const rows: Row[] = useMemo(() => {
    const byThread = new Map(
      language.flatMap((doc) => doc.threads.map((t) => [t.thread_id, t] as const)),
    );
    const hrefOf = new Map(hrefs.map((h) => [h.thread_id, h.href]));
    return measures.map((m) => {
      const extra = byThread.get(m.thread_id);
      return {
        ...m,
        median_distinctiveness: extra?.median_distinctiveness ?? null,
        share_offering_nothing_checkable: extra?.share_offering_nothing_checkable ?? null,
        href: hrefOf.get(m.thread_id) ?? "",
      };
    });
  }, [measures, language, hrefs]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = rows.filter(
      (r) =>
        (list === "all" || r.list_name === list) &&
        (!needle || r.subject.toLowerCase().includes(needle)),
    );
    const direction = descending ? -1 : 1;
    return [...matching].sort((a, b) => {
      if (sort === "last") {
        return direction * (a.measured_at ?? "").localeCompare(b.measured_at ?? "");
      }
      const left = a[sort];
      const right = b[sort];
      // Unmeasured always sorts last, whichever way the column is pointing —
      // an absent measure is not a low one.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return direction * ((left as number) - (right as number)) || a.thread_id.localeCompare(b.thread_id);
    });
  }, [rows, query, list, sort, descending]);

  const floor = language[0]?.distribution.message_floor ?? 4;
  const covered = useMemo(
    () => rows.filter((r) => r.median_distinctiveness !== null).length,
    [rows],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE, current * PAGE + PAGE);

  const toggle = (key: SortKey) => {
    if (key === sort) setDescending((d) => !d);
    else {
      setSort(key);
      setDescending(true);
    }
    setPage(0);
  };

  return (
    <div className="space-y-3">
      <div className="bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <Input
          className="h-8 w-64 text-xs"
          placeholder="Find a thread by subject…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          aria-label="Find a thread by subject"
        />
        <div className="flex items-center gap-1" role="group" aria-label="Filter by list">
          <Button
            size="sm"
            variant={list === "all" ? "default" : "outline"}
            onClick={() => {
              setList("all");
              setPage(0);
            }}
          >
            Both lists
          </Button>
          {lists.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={list === name ? "default" : "outline"}
              onClick={() => {
                setList(name);
                setPage(0);
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        <span className="text-muted-foreground ml-auto text-xs">
          {filtered.length} of {rows.length} threads
          {filtered.length > PAGE && ` · page ${current + 1} of ${pages}`}
        </span>
      </div>

      <div className="text-muted-foreground text-xs">
        <strong className="text-foreground font-medium">{covered}</strong> of {rows.length}{" "}
        threads run to {floor} messages or more. Below that a median is one or two values,
        so <em>Novelty</em>, <em>Belongs here</em> and <em>Nothing to check</em> are withheld
        rather than shown — sorting by them was putting two-message threads at the top.
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[24rem]">Thread</TableHead>
              {COLUMNS.map((column) => (
                <TableHead key={column.key} className="text-right">
                  <button
                    type="button"
                    onClick={() => toggle(column.key)}
                    title={column.help}
                    className={cn(
                      "hover:text-foreground inline-flex items-center gap-1",
                      sort === column.key && "text-foreground font-semibold",
                    )}
                    aria-label={`Sort by ${column.label}`}
                  >
                    {column.label}
                    <span aria-hidden className="text-[10px]">
                      {sort === column.key ? (descending ? "▼" : "▲") : "↕"}
                    </span>
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              return (
                <TableRow key={row.thread_id}>
                  <TableCell className="max-w-[34rem] whitespace-normal">
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary hover:underline"
                      // The table describes threads; it should also be able to
                      // reach them. Without this a reader who finds something
                      // interesting has no way to go and read it.
                      title="Open this thread in the IETF mail archive"
                    >
                      {tidySubject(row.subject)}
                    </a>
                    <span className="text-muted-foreground ml-2 text-[10px] tracking-wide uppercase">
                      {row.list_name}
                    </span>
                  </TableCell>
                  {COLUMNS.map((column) => (
                    <TableCell key={column.key} className="text-right">
                      {column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={COLUMNS.length + 1}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  No thread matches {query ? `“${query}”` : "this filter"}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Showing {current * PAGE + 1}–{Math.min(filtered.length, (current + 1) * PAGE)} of{" "}
            {filtered.length}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
