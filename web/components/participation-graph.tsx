"use client";

/**
 * The bipartite participation graph, plus the person-to-person reply graph.
 *
 * Encoding — three quantities, three channels, so none is inferred from another:
 *   size   = volume (messages), by area
 *   fill   = reputation, a single-hue sequential ramp on personalized PageRank
 *   border = community-conferred standing (thick solid vs thin dashed)
 *
 * A large, faint node is high volume with little reception, which is the pattern
 * PROBLEM.md §1 exists to surface. Community is a number in the table, not a
 * hue: eight categorical colours cannot be told apart when every pair is on
 * screen at once, which is exactly the case in a node-link diagram.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Person, PrivateData, Thread } from "@/lib/data";

cytoscape.use(fcose as never);

type Mode = "both" | "part" | "reply";

const MODES: { id: Mode; label: string }[] = [
  { id: "both", label: "Participation + replies" },
  { id: "part", label: "Participation" },
  { id: "reply", label: "Replies" },
];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function ParticipationGraph({ data }: { data: PrivateData }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [mode, setMode] = useState<Mode>("both");
  const [minSize, setMinSize] = useState(2);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<
    { kind: "person"; row: Person } | { kind: "thread"; row: Thread } | null
  >(null);
  const [stats, setStats] = useState("");

  const personById = useMemo(
    () => new Map(data.persons.map((p) => [p.id, p])),
    [data.persons],
  );
  const threadById = useMemo(
    () => new Map(data.threads.map((t) => [t.id, t])),
    [data.threads],
  );

  /** Fill by rank, not raw score: PageRank has a long near-zero tail that a
   *  linear ramp collapses into a single shade. */
  const fillRank = useMemo(() => {
    const order = [...data.persons].sort(
      (a, b) => (a.ppr_replies ?? 0) - (b.ppr_replies ?? 0),
    );
    const map = new Map<string, number>();
    order.forEach((p, i) => map.set(p.id, order.length > 1 ? i / (order.length - 1) : 1));
    return map;
  }, [data.persons]);

  const runLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const started = performance.now();
    const layout = cy.layout({
      name: "fcose",
      quality: "proof",
      animate: false,
      randomize: true,
      nodeSeparation: 120,
      nodeRepulsion: 9000,
      gravity: 0.2,
      idealEdgeLength: (edge: { data: (k: string) => unknown }) =>
        edge.data("kind") === "part" ? 80 : 130,
      packComponents: true,
      tile: true,
      tilingPaddingVertical: 28,
      tilingPaddingHorizontal: 28,
      padding: 26,
    } as never);
    // fCoSE settles asynchronously even with animate:false, so timing the
    // .run() call reports 0ms. Measure when the layout actually stops.
    layout.one("layoutstop", () => {
      cy.fit(undefined, 26);
      setStats(
        `${cy.nodes(":visible").length} nodes, ${cy.edges(":visible").length} edges · layout ${Math.round(
          performance.now() - started,
        )} ms`,
      );
    });
    layout.run();
  }, []);

  // Build once. Filters and selection mutate styles rather than rebuilding.
  useEffect(() => {
    if (!boxRef.current) return;
    const ramp = ["--seq-100", "--seq-250", "--seq-400", "--seq-550", "--seq-700"].map(cssVar);
    // Canvas-safe tokens only. Cytoscape draws to a 2D canvas and cannot parse
    // oklch(); handed one it paints black, which turns every label into a blob.
    const ink = cssVar("--cy-ink") || "#1c1917";
    const panel = cssVar("--cy-halo") || "#ffffff";
    const primary = cssVar("--cy-primary") || "#2a78d6";
    const threadBg = cssVar("--thread-bg") || "#eceae4";
    const threadLine = cssVar("--thread-line") || "#8b8a85";
    const warn = cssVar("--cy-warn") || "#8a5a00";

    const maxMsg = Math.max(1, ...data.persons.map((p) => p.messages));
    const maxThread = Math.max(1, ...data.threads.map((t) => t.message_count));

    const elements: cytoscape.ElementDefinition[] = [
      ...data.persons.map((p) => ({
        data: {
          id: `p:${p.id}`,
          kind: "person",
          ref: p.id,
          label: p.label,
          sz: 16 + 40 * Math.sqrt(p.messages / maxMsg),
          fill: ramp[Math.min(ramp.length - 1, Math.floor((fillRank.get(p.id) ?? 0) * ramp.length))],
          seeded: p.seeded ? "yes" : "no",
        },
      })),
      ...data.threads.map((t) => ({
        data: {
          id: `t:${t.id}`,
          kind: "thread",
          ref: t.id,
          label: t.label,
          sz: 22 + 60 * Math.sqrt(t.message_count / maxThread),
          hh: 14 + 16 * Math.sqrt(t.message_count / maxThread),
        },
      })),
      ...data.participation.map((e, i) => ({
        data: {
          id: `part${i}`, kind: "part",
          source: `p:${e.person}`, target: `t:${e.thread}`,
          w: 0.7 + 2.0 * Math.sqrt(e.messages),
        },
      })),
      ...data.replies.map((e, i) => ({
        data: {
          id: `rep${i}`, kind: "reply",
          source: `p:${e.source}`, target: `p:${e.target}`,
          w: 0.8 + 1.4 * Math.sqrt(e.replies),
        },
      })),
    ];

    const cy = cytoscape({
      container: boxRef.current,
      elements,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: 'node[kind="person"]',
          style: {
            "background-color": "data(fill)", "border-color": primary,
            width: "data(sz)", height: "data(sz)",
            label: "data(label)", "font-size": 11, color: ink,
            "text-outline-color": panel, "text-outline-width": 2.5,
            "text-valign": "bottom", "text-margin-y": 3, "min-zoomed-font-size": 7,
          },
        },
        { selector: 'node[kind="person"][seeded="yes"]', style: { "border-width": 3.5, "border-style": "solid" } },
        { selector: 'node[kind="person"][seeded="no"]', style: { "border-width": 1.5, "border-style": "dashed" } },
        {
          selector: 'node[kind="thread"]',
          style: {
            shape: "round-rectangle", "background-color": threadBg,
            "border-color": threadLine, "border-width": 1.2,
            width: "data(sz)", height: "data(hh)",
            label: "data(label)", "font-size": 10, color: ink,
            "text-outline-color": panel, "text-outline-width": 2.5,
            "text-valign": "bottom", "text-margin-y": 3,
            "text-wrap": "ellipsis", "text-max-width": "160px", "min-zoomed-font-size": 8,
          },
        },
        { selector: 'edge[kind="part"]', style: { width: "data(w)", "line-color": threadLine, opacity: 0.45, "curve-style": "straight" } },
        {
          selector: 'edge[kind="reply"]',
          style: {
            width: "data(w)", "line-color": primary, opacity: 0.45,
            "curve-style": "bezier", "control-point-step-size": 26,
            "target-arrow-shape": "triangle", "target-arrow-color": primary, "arrow-scale": 0.75,
          },
        },
        { selector: ".dim", style: { opacity: 0.07, "text-opacity": 0 } },
        { selector: ".pick", style: { "border-color": warn, "border-width": 4, "z-index": 99 } },
      ],
    });

    cy.on("tap", "node", (evt) => {
      const node = evt.target as NodeSingular;
      pick(cy, node);
      const ref = node.data("ref") as string;
      setSelected(
        node.data("kind") === "person"
          ? { kind: "person", row: personById.get(ref)! }
          : { kind: "thread", row: threadById.get(ref)! },
      );
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass("pick dim");
        setSelected(null);
      }
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data, fillRank, personById, threadById]);

  // Filters
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().style("display", "element");
      if (mode === "part") cy.edges('[kind="reply"]').style("display", "none");
      if (mode === "reply") {
        cy.edges('[kind="part"]').style("display", "none");
        cy.nodes('[kind="thread"]').style("display", "none");
      }
      if (minSize > 1) {
        cy.nodes('[kind="thread"]').forEach((n) => {
          const t = threadById.get(n.data("ref") as string);
          if (t && t.message_count < minSize) n.style("display", "none");
        });
      }
      if (hideIsolated) {
        cy.nodes().forEach((n) => {
          if (n.style("display") === "none") return;
          const live = n.connectedEdges().filter(
            (e) =>
              e.style("display") !== "none" &&
              e.source().style("display") !== "none" &&
              e.target().style("display") !== "none",
          );
          if (live.length === 0) n.style("display", "none");
        });
      }
    });
    runLayout();
  }, [mode, minSize, hideIsolated, runLayout, threadById]);

  // Search dims everything outside the match's neighbourhood.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass("dim");
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit = cy.nodes().filter((n) => {
      const ref = n.data("ref") as string;
      const p = personById.get(ref);
      const t = threadById.get(ref);
      const hay = p ? `${p.full} ${p.address}` : t ? t.subject : "";
      return hay.toLowerCase().includes(q);
    });
    if (hit.length) cy.elements().difference(hit.closedNeighborhood()).addClass("dim");
  }, [query, personById, threadById]);

  const focus = useCallback((id: string) => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(id);
    if (!node || node.length === 0) return;
    pick(cy, node as NodeSingular);
    const ref = node.data("ref") as string;
    setSelected(
      node.data("kind") === "person"
        ? { kind: "person", row: personById.get(ref)! }
        : { kind: "thread", row: threadById.get(ref)! },
    );
    cy.animate({ center: { eles: node }, zoom: 1.25 }, { duration: 220 });
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [personById, threadById]);

  return (
    <>
      <div className="bg-card mb-2 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <div className="flex overflow-hidden rounded-md border">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={cn(
                "px-3 py-1.5 text-xs",
                mode === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          Min thread size
          <Slider
            className="w-28"
            min={1} max={10} step={1}
            value={[minSize]}
            onValueChange={(v) => setMinSize(v[0] ?? 1)}
          />
          <span className="tnum w-4">{minSize}</span>
        </label>
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={hideIsolated}
            onChange={(e) => setHideIsolated(e.target.checked)}
          />
          Hide unconnected
        </label>
        <Input
          className="h-8 w-56 text-xs"
          placeholder="Find a person or thread…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={runLayout}>Re-run layout</Button>
        <Button size="sm" variant="outline" onClick={() => cyRef.current?.fit(undefined, 26)}>Fit</Button>
        <span className="text-muted-foreground ml-auto text-xs">{stats}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_21rem]">
        <div
          ref={boxRef}
          role="application"
          aria-label="Participation graph"
          className="bg-card h-[min(74vh,760px)] rounded-lg border"
        />
        <aside className="bg-card max-h-[min(74vh,760px)] overflow-auto rounded-lg border p-4 text-sm">
          {!selected && (
            <p className="text-muted-foreground">
              Click a node to see its profile. Circles are people, rectangles are threads.
            </p>
          )}
          {selected?.kind === "person" && (
            <PersonPanel person={selected.row} threadById={threadById} onGoto={focus} />
          )}
          {selected?.kind === "thread" && (
            <ThreadPanel
              thread={selected.row}
              participation={data.participation}
              personById={personById}
              onGoto={focus}
            />
          )}
        </aside>
      </div>

      <GraphTables
        data={data}
        onGoto={focus}
      />
    </>
  );
}

function pick(cy: Core, node: NodeSingular) {
  cy.elements().removeClass("pick dim");
  cy.elements().difference(node.closedNeighborhood()).addClass("dim");
  node.addClass("pick");
}

function day(s: string | null) {
  return s ? s.slice(0, 10) : "—";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tnum m-0">{children}</dd>
    </>
  );
}

function PersonPanel({
  person, threadById, onGoto,
}: {
  person: Person;
  threadById: Map<string, Thread>;
  onGoto: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="text-base leading-tight font-semibold">{person.full}</h3>
      <p className="text-muted-foreground mt-0.5 mb-2 text-xs break-all">
        {person.address || "address not recorded"}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <Row label="Messages">{person.messages}</Row>
        <Row label="Threads">{person.threads_participated} ({person.threads_started} started)</Row>
        <Row label="Replies sent">{person.replies_sent}</Row>
        <Row label="Replies received">{person.replies_received}</Row>
        <Row label="Reputation">
          {person.ppr_replies?.toFixed(4) ?? "—"} (rank {person.rank_replies ?? "—"})
        </Row>
        <Row label="Quote-weighted">{person.ppr_quoting?.toFixed(4) ?? "—"}</Row>
        <Row label="Community">{person.community ?? "—"}</Row>
        <Row label="k-core">{person.core_number ?? "—"}</Row>
        <Row label="First seen">{day(person.first_seen)}</Row>
        <Row label="Last seen">{day(person.last_seen)}</Row>
      </dl>
      <p className="mt-3 mb-1 text-[13px] font-semibold">Standing</p>
      {person.seeded ? (
        <div className="flex flex-wrap gap-1">
          {person.clauses.map((c) => (
            <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          {person.unseeded_reason ?? "no clause matched"}
        </p>
      )}
      {person.top_threads.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-[13px] font-semibold">Most active in</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {person.top_threads.map((r) => (
              <li key={r.thread_id}>
                <button
                  className="text-primary text-left hover:underline"
                  onClick={() => onGoto(`t:${r.thread_id}`)}
                >
                  {threadById.get(r.thread_id)?.subject.replace(/^\[[^\]]+\]\s*/, "") ?? r.thread_id}
                </button>{" "}
                <span className="text-muted-foreground">({r.messages})</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-muted-foreground mt-4 text-[11px] leading-snug">
        Reputation is a position in the reply graph. It is not a judgement of this
        person&apos;s contribution, and nothing here concerns how their messages were
        written.
      </p>
    </div>
  );
}

function ThreadPanel({
  thread, participation, personById, onGoto,
}: {
  thread: Thread;
  participation: PrivateData["participation"];
  personById: Map<string, Person>;
  onGoto: (id: string) => void;
}) {
  const who = participation
    .filter((e) => e.thread === thread.id)
    .sort((a, b) => b.messages - a.messages);
  return (
    <div>
      <h3 className="text-base leading-tight font-semibold">{thread.subject}</h3>
      <p className="text-muted-foreground mt-0.5 mb-2 text-xs break-all">{thread.id}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <Row label="Messages">{thread.message_count}</Row>
        <Row label="Participants">{thread.distinct_senders}</Row>
        <Row label="Max depth">{thread.max_depth}</Row>
        <Row label="Reply pairs">{thread.reply_pairs}</Row>
        <Row label="Branching">{thread.mean_branching_factor.toFixed(2)}</Row>
        <Row label="With standing">{thread.seeded_participants ?? "—"}</Row>
        <Row label="Substantive">
          {thread.substantive_reply_ratio === null || thread.substantive_reply_ratio === undefined ? (
            <span className="text-muted-foreground italic">not measured</span>
          ) : (
            `${Math.round(thread.substantive_reply_ratio * 100)}%`
          )}
        </Row>
        <Row label="Started">{day(thread.started_at)}</Row>
        <Row label="Last message">{day(thread.last_message_at)}</Row>
      </dl>
      {who.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-[13px] font-semibold">Who posted</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {who.map((e) => (
              <li key={e.person}>
                <button
                  className="text-primary text-left hover:underline"
                  onClick={() => onGoto(`p:${e.person}`)}
                >
                  {personById.get(e.person)?.full ?? e.person}
                </button>{" "}
                <span className="text-muted-foreground">({e.messages})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GraphTables({ data, onGoto }: { data: PrivateData; onGoto: (id: string) => void }) {
  return (
    <>
      <h2 className="mt-8 mb-2 border-b pb-1 text-lg font-semibold">People</h2>
      <div className="max-h-[26rem] overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-background sticky top-0">
            <tr className="border-b">
              {["Name", "Msgs", "Threads", "Started", "Sent", "Recv", "Rank", "PPR", "Cmty", "Core", "Standing"].map(
                (h, i) => (
                  <th key={h} className={cn("px-2 py-1.5 text-left font-semibold", i > 0 && i < 10 && "text-right")}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.persons.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="px-2 py-1">
                  <button className="text-primary text-left hover:underline" onClick={() => onGoto(`p:${p.id}`)}>
                    {p.full}
                  </button>
                </td>
                <td className="tnum px-2 py-1 text-right">{p.messages}</td>
                <td className="tnum px-2 py-1 text-right">{p.threads_participated}</td>
                <td className="tnum px-2 py-1 text-right">{p.threads_started}</td>
                <td className="tnum px-2 py-1 text-right">{p.replies_sent}</td>
                <td className="tnum px-2 py-1 text-right">{p.replies_received}</td>
                <td className="tnum px-2 py-1 text-right">{p.rank_replies ?? "—"}</td>
                <td className="tnum px-2 py-1 text-right">{p.ppr_replies?.toFixed(4) ?? "—"}</td>
                <td className="tnum px-2 py-1 text-right">{p.community ?? "—"}</td>
                <td className="tnum px-2 py-1 text-right">{p.core_number ?? "—"}</td>
                <td className="px-2 py-1">
                  {p.seeded ? (
                    <span className="flex flex-wrap gap-0.5">
                      {p.clauses.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[9px]">{c}</Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{p.unseeded_reason}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 mb-2 border-b pb-1 text-lg font-semibold">Threads</h2>
      <div className="max-h-[26rem] overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-background sticky top-0">
            <tr className="border-b">
              {["Subject", "Msgs", "People", "Depth", "Branching", "With standing", "Started"].map((h, i) => (
                <th key={h} className={cn("px-2 py-1.5 text-left font-semibold", i > 0 && i < 6 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.threads.map((t) => (
              <tr key={t.id} className="border-b">
                <td className="px-2 py-1">
                  <button className="text-primary text-left hover:underline" onClick={() => onGoto(`t:${t.id}`)}>
                    {t.subject}
                  </button>
                </td>
                <td className="tnum px-2 py-1 text-right">{t.message_count}</td>
                <td className="tnum px-2 py-1 text-right">{t.distinct_senders}</td>
                <td className="tnum px-2 py-1 text-right">{t.max_depth}</td>
                <td className="tnum px-2 py-1 text-right">{t.mean_branching_factor.toFixed(2)}</td>
                <td className="tnum px-2 py-1 text-right">{t.seeded_participants ?? "—"}</td>
                <td className="px-2 py-1">{day(t.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
