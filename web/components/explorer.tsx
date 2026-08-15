"use client";

/**
 * The graph explorer: topics, threads and people over a lookback window.
 *
 * Starts at topics and expands on click. Level of detail is the design, not an
 * optimisation — 1,233 message nodes at once is unreadable whatever renders it.
 */

import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { buildView, type GraphNode, type GraphSource } from "@/lib/graph-model";
import dynamic from "next/dynamic";

// sigma touches WebGL2RenderingContext at import time, which does not exist
// during static prerendering. Loaded client-side only.
const SigmaGraph = dynamic(
  () => import("@/components/sigma-graph").then((m) => m.SigmaGraph),
  {
    ssr: false,
    loading: () => (
      <div className="bg-card text-muted-foreground flex h-[560px] w-full items-center justify-center rounded-lg border text-xs">
        Loading graph…
      </div>
    ),
  },
);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tnum m-0">{children}</dd>
    </>
  );
}

export function Explorer({
  source,
  windowThreadIds,
  named,
}: {
  source: GraphSource;
  windowThreadIds?: string[];
  named: boolean;
}) {
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [showPeople, setShowPeople] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [query, setQuery] = useState("");

  const threadIds = useMemo(
    () => (windowThreadIds ? new Set(windowThreadIds) : undefined),
    [windowThreadIds],
  );

  const view = useMemo(
    () =>
      buildView(source, {
        expandedTopics,
        expandedThreads: new Set(),
        showPeople,
        showUnassigned,
        threadIds,
      }),
    [source, expandedTopics, showPeople, showUnassigned, threadIds],
  );

  const onSelect = useCallback((node: GraphNode | null) => {
    setSelected(node);
    if (node?.tier === "topic") {
      setExpandedTopics((prev) => {
        const next = new Set(prev);
        if (next.has(node.ref)) next.delete(node.ref);
        else next.add(node.ref);
        return next;
      });
    }
  }, []);

  const topicById = useMemo(() => new Map(source.topics.map((t) => [t.id, t])), [source.topics]);
  const threadById = useMemo(() => new Map(source.threads.map((t) => [t.id, t])), [source.threads]);
  const personById = useMemo(() => new Map(source.persons.map((p) => [p.id, p])), [source.persons]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [
      ...source.topics
        .filter((t) => (t.label ?? "").toLowerCase().includes(q) || t.subjects.some((s) => s.toLowerCase().includes(q)))
        .map((t) => ({ kind: "topic" as const, id: t.id, label: t.label ?? t.subjects[0] ?? t.id })),
      ...source.threads
        .filter((t) => t.subject.toLowerCase().includes(q))
        .slice(0, 8)
        .map((t) => ({ kind: "thread" as const, id: t.id, label: t.subject })),
      ...(named
        ? source.persons
            .filter((p) => p.label.toLowerCase().includes(q))
            .slice(0, 8)
            .map((p) => ({ kind: "person" as const, id: p.id, label: p.label }))
        : []),
    ].slice(0, 12);
  }, [query, source, named]);

  return (
    <div className="space-y-2">
      <div className="bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        {/* People are a private join: the public page ships no participation
            rows, so the control would be a button that can never do anything. */}
        {named && (
          <Button
            size="sm"
            variant={showPeople ? "default" : "outline"}
            onClick={() => setShowPeople((v) => !v)}
          >
            {showPeople ? "Hide people" : "Show people"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setExpandedTopics(new Set(source.topics.map((t) => t.id)))}
        >
          Expand all topics
        </Button>
        <Button size="sm" variant="outline" onClick={() => setExpandedTopics(new Set())}>
          Collapse
        </Button>
        <Button
          size="sm"
          variant={showUnassigned ? "default" : "outline"}
          onClick={() => setShowUnassigned((v) => !v)}
          title="Threads that belong with no topic"
        >
          Unassigned
        </Button>
        <Input
          className="h-8 w-56 text-xs"
          placeholder={named ? "Find a topic, thread or person…" : "Find a topic or thread…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-muted-foreground ml-auto text-xs">
          {expandedTopics.size} of {source.topics.length} topics expanded · click a topic to open it
        </span>
      </div>

      {matches.length > 0 && (
        <div className="bg-card flex flex-wrap gap-1 rounded-lg border p-2">
          {matches.map((m) => (
            <button
              key={`${m.kind}:${m.id}`}
              className="hover:bg-accent rounded border px-2 py-1 text-left text-xs"
              onClick={() => {
                if (m.kind === "topic") setExpandedTopics((p) => new Set(p).add(m.id));
                if (m.kind === "thread") {
                  const t = threadById.get(m.id);
                  if (t?.topic_id) setExpandedTopics((p) => new Set(p).add(t.topic_id!));
                }
                if (m.kind === "person") setShowPeople(true);
              }}
            >
              <span className="text-muted-foreground mr-1">{m.kind}</span>
              {m.label.slice(0, 48)}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_19rem]">
        <SigmaGraph view={view} onSelect={onSelect} selectedKey={selected?.key ?? null} />
        <aside
          data-testid="detail-panel"
          className="bg-card max-h-[560px] overflow-auto rounded-lg border p-3 text-sm"
        >
          {!selected && (
            <p className="text-muted-foreground text-xs">
              Circles are topics{named ? " and people" : ""}, squares are threads. Click a topic
              to expand it into its threads; click again to collapse. Size is messages, fill is
              novelty{named ? " for topics and threads, reputation for people" : ""}.
            </p>
          )}
          {selected?.tier === "topic" && (() => {
            const t = topicById.get(selected.ref)!;
            return (
              <div>
                <h3 className="text-sm font-semibold">{t.label ?? t.subjects[0]}</h3>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <Row label="Threads">{t.thread_count}</Row>
                  <Row label="Messages">{t.message_count}</Row>
                  <Row label="Participants">{t.distinct_senders}</Row>
                  <Row label="Median novelty">
                    {t.median_novelty === null ? "—" : t.median_novelty.toFixed(2)}
                  </Row>
                  <Row label="Started">{t.started_at?.slice(0, 10) ?? "—"}</Row>
                </dl>
                <p className="mt-2 mb-1 text-xs font-semibold">Subjects merged here</p>
                <ul className="list-disc space-y-0.5 pl-4 text-xs">
                  {t.subjects.slice(0, 10).map((s) => <li key={s}>{s}</li>)}
                </ul>
              </div>
            );
          })()}
          {selected?.tier === "thread" && (() => {
            const t = threadById.get(selected.ref)!;
            return (
              <div>
                <h3 className="text-sm leading-snug font-semibold">{t.subject}</h3>
                {t.gist && (
                  <p className="text-muted-foreground mt-1 text-xs leading-snug italic">
                    &ldquo;{t.gist}&rdquo;
                  </p>
                )}
                {t.href && (
                  <a
                    href={t.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary mt-1 inline-block text-xs hover:underline"
                  >
                    Open in the IETF mail archive ↗
                  </a>
                )}
                {(t.reach !== undefined || t.median_novelty !== null) && (
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md border p-2 text-[11px]">
                    <Row label="Reach">{t.reach?.toFixed(2) ?? "—"}</Row>
                    <Row label="Uptake from standing">
                      {t.uptakeFromStanding?.toFixed(2) ?? "—"}
                    </Row>
                    <Row label="Novelty">
                      {t.median_novelty === null ? "—" : t.median_novelty.toFixed(2)}
                    </Row>
                  </dl>
                )}
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <Row label="Messages">{t.message_count}</Row>
                  <Row label="Participants">{t.distinct_senders}</Row>
                  <Row label="Last message">{t.last_message_at?.slice(0, 10) ?? "—"}</Row>
                </dl>
              </div>
            );
          })()}
          {selected?.tier === "person" && (() => {
            const p = personById.get(selected.ref)!;
            return (
              <div>
                <h3 className="text-sm font-semibold">{p.label}</h3>
                <div className="mt-1 flex gap-1">
                  {p.steward && <Badge variant="default" className="text-[10px]">steward</Badge>}
                  {p.seeded && <Badge variant="secondary" className="text-[10px]">standing</Badge>}
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <Row label="Messages">{p.messages}</Row>
                  <Row label="Reputation">
                    {p.reputation === null ? "—" : p.reputation.toFixed(4)}
                  </Row>
                </dl>
                <p className="text-muted-foreground mt-3 text-[11px]">
                  Reputation is a position in the reply graph, not a judgement of this
                  person&apos;s contribution — and nothing here concerns how their messages
                  were written.
                </p>
              </div>
            );
          })()}
        </aside>
      </div>

      <div className={cn("text-muted-foreground flex flex-wrap items-center gap-4 text-xs")}>
        {/* Hue is the list, and the legend has to say so: a single "topic"
            swatch in the sequential blue was simply the wrong colour, because
            every topic on screen is drawn in its own list's ramp. */}
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-full bg-[var(--l1-500)]" /> agentproto
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-full bg-[var(--l2-500)]" /> agent2agent
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-full bg-[var(--l2-500)]" />
          <i className="inline-block size-3 rounded-[2px] bg-[var(--l2-500)]" />
          topic / thread
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-[2px] bg-[var(--thread-line)]" /> novelty not
          measured
        </span>
        {named && (
          <span className="flex items-center gap-1.5">
            <i className="inline-block size-3 rounded-full bg-[var(--seq-700)]" /> person
          </span>
        )}
        <span className="flex items-center gap-1.5">
          novelty
          <i className="inline-block h-2 w-14 rounded-sm border bg-[linear-gradient(90deg,var(--l2-100),var(--l2-300),var(--l2-700))]" />
          low → high
        </span>
        <span>size ∝ messages</span>
      </div>
    </div>
  );
}
