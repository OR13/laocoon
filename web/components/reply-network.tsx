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

export type Band = "none" | "some" | "established" | "extensive";

export interface NetworkPerson {
  id: string;
  name: string;
  /** 0-100 from published RFCs, adopted drafts and IETF roles. */
  score: number;
  band: Band;
  rfcs: number;
  adopted_drafts: number;
  chairs_now: boolean;
  in_datatracker: boolean;
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

/**
 * Bands of published record. Named for a quantity of work, never for a kind of
 * person — the binary these replace read as a caste mark, which is the whole
 * reason the score exists.
 *
 * Sequential, because the thing encoded is a magnitude: one hue getting
 * darker, with a neutral for the zero that is not a low value but an absence.
 */
export const BAND_META: Record<Band, { label: string; token: string; help: string }> = {
  extensive: { label: "60–100", token: "--seq-700", help: "Extensive published record." },
  established: { label: "30–59", token: "--seq-400", help: "Established published record." },
  some: { label: "1–29", token: "--seq-250", help: "Some published work." },
  none: {
    label: "0",
    token: "--eng-none",
    help:
      "Nothing published under this address in the Datatracker. That is the ordinary " +
      "state of a new participant and of anyone who contributes without filing documents.",
  },
};
export const BAND_ORDER: Band[] = ["extensive", "established", "some", "none"];

/** What the filter chips offer. Each is one lookup, not a judgement. */
export const FILTERS = [
  { id: "all", label: "Everyone", test: () => true },
  {
    id: "datatracker",
    label: "In the Datatracker",
    test: (p: NetworkPerson) => p.in_datatracker,
  },
  { id: "rfc", label: "Has an RFC", test: (p: NetworkPerson) => p.rfcs >= 1 },
  { id: "rfcs", label: "3 or more RFCs", test: (p: NetworkPerson) => p.rfcs >= 3 },
] as const;
export type FilterId = (typeof FILTERS)[number]["id"];

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
  const [filter, setFilter] = useState<FilterId>("all");
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
    const test = FILTERS.find((f) => f.id === filter)!.test;
    const eligible = new Set(people.filter(test).map((p) => p.id));
    const kept = edges.filter(
      (e) => e.replies >= minReplies && eligible.has(e.source) && eligible.has(e.target),
    );
    // Only people the filter leaves connected. A rim of isolated dots is not
    // information the picture is trying to carry — the counts are in the
    // legend, and every account is on the threads page.
    const connected = new Set(kept.flatMap((e) => [e.source, e.target]));
    return { edges: kept, people: people.filter((p) => connected.has(p.id)) };
  }, [people, edges, minReplies, filter]);

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
        band: p.band,
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

    // Dragging, driven by sigma's own hit test rather than by its `downNode`
    // event. That event never fired here — `moveBody` and `upStage` did, so
    // the captor was live and the node simply was not being matched at
    // mousedown — while `getNodeAtPosition` returns the right node for the
    // same coordinates. Going straight to the hit test skips the question.
    const container = renderer.getContainer() as HTMLElement;

    // sigma measures the container once and does not watch it. The review
    // panel adds 19rem of body padding, so the graph was initialising at
    // 1096px, and the moment anything triggered a resize check it jumped 152px
    // — exactly half the 304px the panel occupies. Every position a reader
    // clicked before that jump was measured against the wrong viewport.
    const observer = new ResizeObserver(() => renderer.refresh());
    observer.observe(container);

    let dragging: string | null = null;

    const relative = (event: MouseEvent) => {
      const box = container.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    /**
     * Nearest node under the pointer, computed from display positions.
     *
     * Not sigma's `getNodeAtPosition`: that returns the right node when called
     * cold and null when called from inside a mousedown while a node is
     * hovered, because the hover handler refreshes and reindexes underneath
     * it. A hit test is a distance comparison, so doing it here removes the
     * dependency on when the index was last built.
     */
    const nodeUnder = (point: { x: number; y: number }): string | null => {
      let best: string | null = null;
      let bestDistance = Infinity;
      graph.forEachNode((key) => {
        const display = renderer.getNodeDisplayData(key);
        if (!display) return;
        const at = renderer.framedGraphToViewport(display);
        const radius = renderer.scaleSize
          ? renderer.scaleSize(display.size)
          : (display.size as number);
        const distance = Math.hypot(at.x - point.x, at.y - point.y);
        if (distance <= Math.max(radius, 4) && distance < bestDistance) {
          bestDistance = distance;
          best = key;
        }
      });
      return best;
    };

    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const hit = nodeUnder(relative(event));
      if (!hit) return;
      dragging = hit;
      graph.setNodeAttribute(hit, "highlighted", true);
      // Otherwise the canvas pans under the node being moved.
      renderer.getCamera().disable();
      event.preventDefault();
    };
    const onMove = (event: MouseEvent) => {
      if (!dragging) return;
      const point = renderer.viewportToGraph(relative(event));
      graph.setNodeAttribute(dragging, "x", point.x);
      graph.setNodeAttribute(dragging, "y", point.y);
      event.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      graph.removeNodeAttribute(dragging, "highlighted");
      dragging = null;
      renderer.getCamera().enable();
    };
    // Capture phase, on the document. sigma binds its own `mousemove` and
    // `mouseup` on the document at construction and stops propagation while it
    // is panning, so a listener on window downstream of it never ran — the
    // drag latched on mousedown and then nothing moved.
    container.addEventListener("mousedown", onDown, { capture: true });
    document.addEventListener("mousemove", onMove, { capture: true });
    document.addEventListener("mouseup", onUp, { capture: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("mousedown", onDown, { capture: true });
      document.removeEventListener("mousemove", onMove, { capture: true });
      document.removeEventListener("mouseup", onUp, { capture: true });
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
      BAND_ORDER.map((b) => [b, cssVar(BAND_META[b].token)]),
    ) as Record<Band, string>;
    graph.forEachNode((key, attrs) =>
      graph.setNodeAttribute(key, "color", colours[attrs.band as Band]),
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
    renderer.refresh({ skipIndexation: true });
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
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Filter accounts">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={
                filter === f.id
                  ? "bg-primary text-primary-foreground px-3 py-1.5 text-xs"
                  : "text-muted-foreground hover:bg-accent px-3 py-1.5 text-xs"
              }
            >
              {f.label}
            </button>
          ))}
        </div>
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

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="text-muted-foreground">Publication record</span>
        {BAND_ORDER.map((b) => (
          <span key={b} className="flex items-center gap-1.5" title={BAND_META[b].help}>
            <i
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ background: `var(${BAND_META[b].token})` }}
            />
            <span className="text-muted-foreground">{BAND_META[b].label}</span>
            <span className="tnum text-foreground font-medium">
              {shown.people.filter((p) => p.band === b).length}
            </span>
          </span>
        ))}
        <span className="text-muted-foreground ml-auto">
          size is messages sent · a line means one answered the other · drag a node to move it
        </span>
      </div>

      {selected && (
        <div className="bg-card mt-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-sm font-semibold">{selected.name}</span>
            <span className="tnum text-muted-foreground text-xs">
              publication record {selected.score}/100
            </span>
          </div>
          <p className="text-muted-foreground tnum mt-1 text-xs">
            {selected.rfcs} RFC{selected.rfcs === 1 ? "" : "s"} ·{" "}
            {selected.adopted_drafts} adopted draft{selected.adopted_drafts === 1 ? "" : "s"}
            {selected.chairs_now && " · chairs a working group"}
            {!selected.in_datatracker && " · no Datatracker record"}
          </p>
          <p className="text-muted-foreground tnum mt-0.5 text-xs">
            {selected.messages} message{selected.messages === 1 ? "" : "s"} ·{" "}
            {selected.replies_sent} repl{selected.replies_sent === 1 ? "y" : "ies"} sent ·{" "}
            {selected.replies_received} received · {selected.lists.join(", ")}
            {selected.first_seen && ` · first posted ${selected.first_seen.slice(0, 10)}`}
          </p>
        </div>
      )}
    </div>
  );
}
