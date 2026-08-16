"use client";

/**
 * One picture: who replies to whom.
 *
 * **Why a force layout is right here and was wrong twice before.** The two
 * graphs the operator rejected drew topic-contains-thread, a hierarchy with no
 * edges between the things being positioned — so the layout had nothing to
 * lay out, and forceAtlas2 produced a rim of topics around a pile of threads.
 * Person-replies-to-person is an actual network: an edge means one account
 * answered another, and a force layout puts accounts that answer each other
 * near each other. That is the entire content of the picture, and it is what
 * Sack's Conversation Map computes first for a mailing list.
 *
 * Reading it:
 *
 *   position   people who reply to each other sit together
 *   size       messages sent — a count, not a rating
 *   colour     whether the IETF has a record of the account
 *
 * A dense coloured core with grey satellites that only touch each other is the
 * shape the operator is looking for. A grey node deep inside the core is
 * someone new doing well. Neither is a claim about how anything was written.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useTheme } from "next-themes";

const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export type Standing = "standing" | "record" | "no_record";

export interface NetworkPerson {
  id: string;
  name: string;
  standing: Standing;
  messages: number;
  replies_sent: number;
  replies_received: number;
  lists: string[];
  first_seen: string | null;
}
export interface NetworkEdge {
  source: string;
  target: string;
  replies: number;
}

export const STANDING_META: Record<Standing, { label: string; token: string; help: string }> = {
  standing: {
    label: "Holds community-conferred standing",
    token: "--eng-answering",
    help: "A working group chair, area director, IAB or IESG member, RFC author, or author of an adopted draft.",
  },
  record: {
    label: "Has an IETF record",
    token: "--eng-present",
    help: "Resolves to a person in the Datatracker, without matching a standing clause.",
  },
  no_record: {
    label: "No Datatracker record",
    token: "--eng-none",
    help:
      "The address resolves to nobody in the IETF's own records. That includes anyone who " +
      "has simply never filed anything, so it is a fact about a lookup and not an inference.",
  },
};
export const STANDING_ORDER: Standing[] = ["standing", "record", "no_record"];

/** How many names may be drawn at once, before collision pruning. */
const LABEL_CANDIDATES = 40;
const LABEL_GUTTER = 12;

/**
 * Minimum replies between a pair for the line to be drawn.
 *
 * 444 of the 603 pairs on this corpus answered each other exactly once, and
 * drawing all of them put 204 people in one indistinguishable disc. Two or
 * more is a relationship rather than an interaction — the same distinction
 * Conversation Map draws when it plots reciprocating pairs close together and
 * single responders far apart. Nothing is hidden: the control shows every
 * reply on demand.
 */
const DEFAULT_MIN_REPLIES = 2;

export function ReplyNetwork({
  people,
  edges,
  height = 620,
}: {
  people: NetworkPerson[];
  edges: NetworkEdge[];
  height?: number;
}) {
  const [minReplies, setMinReplies] = useState(DEFAULT_MIN_REPLIES);
  const boxRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const drawn = useRef<Set<string>>(new Set());
  const place = useRef<() => void>(() => {});
  const { resolvedTheme } = useTheme();
  const [unsupported, setUnsupported] = useState(false);
  const [selected, setSelected] = useState<NetworkPerson | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const shown = useMemo(() => {
    const kept = edges.filter((e) => e.replies >= minReplies);
    // Only people the filter leaves connected. A rim of isolated dots is not
    // information the picture is trying to carry — the counts are in the
    // legend, and every account is on the threads page.
    const connected = new Set(kept.flatMap((e) => [e.source, e.target]));
    return { edges: kept, people: people.filter((p) => connected.has(p.id)) };
  }, [people, edges, minReplies]);

  useEffect(() => {
    if (!boxRef.current) return;
    try {
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) {
        setUnsupported(true);
        return;
      }
    } catch {
      setUnsupported(true);
      return;
    }

    const graph = new Graph({ multi: false, type: "undirected" });
    const maxMessages = shown.people.reduce((m, p) => Math.max(m, p.messages), 1);
    for (const p of shown.people) {
      graph.addNode(p.id, {
        label: p.name,
        standing: p.standing,
        size: 3 + 17 * Math.sqrt(p.messages / maxMessages),
        messages: p.messages,
        // Seeded on a circle rather than at random, so the force pass starts
        // from something spread out and converges to the same picture on every
        // load. A random seed made the layout different on every refresh.
        x: Math.cos((shown.people.indexOf(p) / shown.people.length) * 2 * Math.PI),
        y: Math.sin((shown.people.indexOf(p) / shown.people.length) * 2 * Math.PI),
      });
    }
    for (const e of shown.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      if (graph.hasEdge(e.source, e.target)) {
        graph.setEdgeAttribute(e.source, e.target, "weight", e.replies);
        continue;
      }
      graph.addEdge(e.source, e.target, {
        weight: e.replies,
        size: Math.min(3, 0.3 + Math.sqrt(e.replies) * 0.4),
      });
    }

    forceAtlas2.assign(graph, {
      iterations: 400,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        barnesHutOptimize: graph.order > 200,
        gravity: 0.8,
        // Wide, because the point of the picture is the gaps between groups.
        scalingRatio: 40,
        // Sizes vary by 6x here; without this the big accounts overlap their
        // own neighbourhoods and the core becomes one solid disc.
        adjustSizes: true,
        outboundAttractionDistribution: true,
      },
    });

    let renderer: Sigma;
    try {
      renderer = new Sigma(graph, boxRef.current, {
        renderLabels: true,
        labelDensity: 0.3,
        labelGridCellSize: 140,
        labelRenderedSizeThreshold: 5,
        minCameraRatio: 0.05,
        maxCameraRatio: 10,
        stagePadding: 50,
        defaultEdgeColor: cssVar("--thread-line") || "#c3c2bb",
      });
    } catch {
      setUnsupported(true);
      return;
    }
    sigmaRef.current = renderer;
    graphRef.current = graph;
    (window as unknown as { __laocoon?: unknown }).__laocoon = { renderer, graph };

    renderer.on("clickNode", ({ node }) => setSelected(byId.get(node) ?? null));
    renderer.on("clickStage", () => setSelected(null));
    renderer.on("enterNode", ({ node }) => setHovered(node));
    renderer.on("leaveNode", () => setHovered(null));

    return () => {
      renderer.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [shown, byId]);

  /** Colour from standing. Re-runs on theme change. */
  useEffect(() => {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph || !renderer) return;
    const colours = Object.fromEntries(
      STANDING_ORDER.map((s) => [s, cssVar(STANDING_META[s].token)]),
    ) as Record<Standing, string>;
    graph.forEachNode((key, attrs) =>
      graph.setNodeAttribute(key, "color", colours[attrs.standing as Standing]),
    );
    renderer.setSetting("labelColor", { color: cssVar("--cy-ink") || "#1c1917" });
    renderer.setSetting("defaultEdgeColor", cssVar("--thread-line") || "#c3c2bb");
    renderer.refresh();
    place.current();
  }, [resolvedTheme, shown]);

  /** Dim everything outside the selection's neighbourhood. */
  useEffect(() => {
    const renderer = sigmaRef.current;
    const graph = graphRef.current;
    if (!renderer || !graph) return;
    const focus = selected?.id ?? hovered;
    const near =
      focus && graph.hasNode(focus) ? new Set([focus, ...graph.neighbors(focus)]) : null;
    renderer.setSetting("nodeReducer", (key, data) => {
      if (near && !near.has(key)) return { ...data, color: "#8882", label: "" };
      return { ...data, label: drawn.current.has(key) || key === focus ? data.label : "" };
    });
    renderer.setSetting("edgeReducer", (key, data) => {
      if (!near) return data;
      const [s, t] = graph.extremities(key);
      return near.has(s) && near.has(t) ? data : { ...data, hidden: true };
    });
    renderer.refresh();
  }, [selected, hovered, shown]);

  /** Greedy name placement: the busiest accounts first, no two overlapping. */
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    const size = renderer.getSetting("labelSize") ?? 14;
    measure.font = `${size}px ${renderer.getSetting("labelFont") ?? "sans-serif"}`;

    const run = () => {
      const graph = graphRef.current;
      if (!graph) return;
      const { width, height: h } = renderer.getDimensions();
      const candidates = graph
        .nodes()
        .sort(
          (a, b) =>
            (graph.getNodeAttribute(b, "messages") as number) -
            (graph.getNodeAttribute(a, "messages") as number),
        )
        .slice(0, LABEL_CANDIDATES);
      const kept: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const next = new Set<string>();
      for (const key of candidates) {
        const display = renderer.getNodeDisplayData(key);
        if (!display) continue;
        const p = renderer.framedGraphToViewport(display);
        const label = String(graph.getNodeAttribute(key, "label") ?? "");
        const w = measure.measureText(label).width;
        const r = renderer.scaleSize ? renderer.scaleSize(display.size) : display.size;
        const box = { x1: p.x - r - LABEL_GUTTER, y1: p.y - size, x2: p.x + w + LABEL_GUTTER, y2: p.y + size };
        if (box.x2 > width || box.x1 < 0 || box.y1 < 0 || box.y2 > h) continue;
        if (kept.some((k) => box.x1 < k.x2 && k.x1 < box.x2 && box.y1 < k.y2 && k.y1 < box.y2)) continue;
        kept.push(box);
        next.add(key);
      }
      const current = drawn.current;
      if (current.size === next.size && [...next].every((k) => current.has(k))) return;
      drawn.current = next;
      renderer.refresh({ skipIndexation: true });
    };

    place.current = run;
    run();
    const camera = renderer.getCamera();
    camera.on("updated", run);
    return () => {
      camera.off("updated", run);
    };
  }, [shown]);

  const reset = useCallback(() => {
    sigmaRef.current?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 320 });
  }, []);

  if (unsupported) {
    return (
      <div
        style={{ height }}
        className="bg-card text-muted-foreground flex w-full items-center justify-center rounded-lg border text-sm"
      >
        This picture needs WebGL, which this browser did not provide.
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <div ref={boxRef} style={{ height }} className="bg-card w-full rounded-lg border" />
        <button
          type="button"
          onClick={reset}
          className="bg-card/90 text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-md border px-2 py-1 text-[11px] shadow-sm"
        >
          Reset view
        </button>
        <span className="text-muted-foreground pointer-events-none absolute bottom-2 left-3 text-[11px]">
          Scroll to zoom · drag to pan · click a person
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Which replies to draw">
          {[
            { n: 2, label: "Repeated exchanges" },
            { n: 1, label: "Every reply" },
          ].map((o) => (
            <button
              key={o.n}
              onClick={() => setMinReplies(o.n)}
              aria-pressed={minReplies === o.n}
              className={
                minReplies === o.n
                  ? "bg-primary text-primary-foreground px-3 py-1.5 text-xs"
                  : "text-muted-foreground hover:bg-accent px-3 py-1.5 text-xs"
              }
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground text-xs">
          {shown.people.length} of {people.length} people, {shown.edges.length} pairs
          {minReplies > 1 && " who answered each other more than once"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        {STANDING_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5" title={STANDING_META[s].help}>
            <i
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ background: `var(${STANDING_META[s].token})` }}
            />
            <span className="text-muted-foreground">{STANDING_META[s].label}</span>
            <span className="tnum text-foreground font-medium">
              {shown.people.filter((p) => p.standing === s).length}
            </span>
          </span>
        ))}
        <span className="text-muted-foreground ml-auto">
          size is messages sent · a line means one answered the other
        </span>
      </div>

      {selected && (
        <div className="bg-card mt-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-sm font-semibold">{selected.name}</span>
            <span className="text-muted-foreground text-xs">
              {STANDING_META[selected.standing].label.toLowerCase()}
            </span>
          </div>
          <p className="text-muted-foreground tnum mt-1 text-xs">
            {selected.messages} message{selected.messages === 1 ? "" : "s"} ·{" "}
            {selected.replies_sent} repl{selected.replies_sent === 1 ? "y" : "ies"} sent ·{" "}
            {selected.replies_received} received ·{" "}
            {selected.lists.join(", ")}
            {selected.first_seen && ` · first posted ${selected.first_seen.slice(0, 10)}`}
          </p>
        </div>
      )}
    </div>
  );
}
